# AGENTS.md — CareLoop project context (single source of truth)

> Every AI agent/model MUST read this file fully at the start of each session, then read `TASKS.md`.
> Before ending a session: update `TASKS.md` statuses, the Progress log (section 14) and the Decisions log (section 15).
> The human owner is a solo student developer who must be able to explain and defend every design decision
> to judges. Do not make silent architectural changes. When unsure, ask.

## 1. Product

**CareLoop** — a screening-to-care coordination platform.
Challenge: *Future Health Digital Innovation Challenge (Abu Dhabi), Challenge 05: Closing the Screening-to-Care Loop.*

Problem: screening programs find actionable results, but patients get lost between notification, consultation,
confirmation, referral, appointment and follow-up, across providers.

Solution: every actionable result becomes a **case** in a strict lifecycle. Each case always answers four questions:
1. What happened to the result?
2. What must happen next?
3. Who is responsible for it?
4. Has the required action actually been completed?

Principle: **AI helps prioritize and communicate; the workflow engine guarantees accountability.**
No autonomous clinical decisions, ever.

**Time box:** 20 days, solo developer. Start date: 3-11-2026. Submission date: 20-11-2026 .

**Required submission:** (1) working prototype, (2) technical documentation, (3) clear statement of
assumptions, dependencies and limitations.

## 2. Challenge requirements -> CareLoop features

| Challenge requirement | CareLoop feature |
|---|---|
| End-to-end case visibility | Case timeline built from an append-only event log (issue -> notify -> acknowledge -> confirm -> referral -> appointment -> care -> closure) |
| Clear ownership, timely progression | Exactly one owner and one `dueAt` per open case; overdue / unassigned / rejected cases surface in an attention queue |
| Patient-centered communication | Patient portal: plain-language explanation, urgency label, status tracker, "I understand" acknowledgement; English + Arabic (RTL) |
| Cross-provider consultation and coordination | Provider organizations, referrals that move between providers (accept / reject / reassign), consult requests (patient->clinician, clinician->clinician) |
| Safe, human-governed escalation | Escalation overlay routes to a human queue; closure only with evidence or authorized clinician sign-off |
| Closure and impact measures | Analytics dashboard + synthetic-cohort simulation comparing baseline (no tracking) vs CareLoop |

## 3. Scope

**In scope (MVP)**
1. Screening case management (synthetic patients/results; clinician approves interpretation and next step)
2. Patient notifications (in-app outbox) and acknowledgement
3. Referrals, appointments, contact attempts, delay reasons, follow-ups, consults
4. Explainable rules-based attention/priority engine (operational, NOT clinical)
5. Plain-language result explanation (template-first, clinician-approved before patient sees it)
6. Admin analytics dashboard + synthetic cohort simulation
7. Four roles: PATIENT, DOCTOR, COORDINATOR, ADMIN
8. Audit trail, consent record, role-based access
9. English + Arabic (RTL) on the patient portal

**Out of scope — document in Limitations, do not build**
Real hospital/lab/EHR integration; real patient data; disease or clinical-risk prediction; ML follow-up
prediction; mobile app; video consultation; blockchain; WebSockets; Redis; Kafka; microservices; real
SMS/WhatsApp/email delivery; autonomous clinical decisions (prohibited).

## 4. Tech stack (locked unless a decision is logged in section 15)

- Monorepo, npm workspaces: `client/` (UI), `server/` (API), `shared/` (TypeScript types + zod schemas used by both), `docs/`
- **Frontend:** Next.js + TypeScript + Tailwind CSS, i18n (en, ar) with RTL, used as a UI client calling the REST API
- **Backend:** Node.js + Express + TypeScript, REST, zod request validation
- **Database:** PostgreSQL + Prisma
- **Auth:** email/password, bcrypt, JWT in httpOnly cookie, role middleware, seeded demo accounts
- **Updates:** polling / refetch. No WebSockets.
- **Tests:** Vitest (unit + integration); Playwright for one end-to-end run of the demo scenario
- **Infra:** Docker Compose (db, server, client), `.env.example`, one-command local run, one hosted demo
- **AI layer:** TypeScript only. LLM (optional) sits behind an `ExplanationProvider` interface. No Python service.

## 5. Architecture

Modular monolith. Controller -> service -> data access (Prisma) in every module.

```
careloop/
├── client/                 # Next.js UI (patient, doctor, coordinator, admin)
├── server/
│   ├── prisma/schema.prisma
│   └── src/
│       ├── config/
│       ├── middleware/     # auth, role, validate, error
│       ├── core/           # clock, stateMachine, eventLog, audit
│       ├── modules/
│       │   ├── auth/  patients/  cases/  referrals/  appointments/
│       │   ├── notifications/  consults/  followups/  consent/
│       │   ├── attention/       # rules-based prioritization
│       │   ├── explanation/     # template + optional LLM provider
│       │   ├── analytics/  simulation/  demo/
│       ├── app.ts
│       └── server.ts
├── shared/                 # types, enums, zod schemas (API contract)
├── docs/
├── AGENTS.md  TASKS.md  README.md  docker-compose.yml
```

### Architecture principles (non-negotiable)
1. **Event log is the source of truth.** One append-only `CaseEvent` table is both the patient-visible timeline and the audit record. Never update or delete events.
2. **One state machine module.** All allowed transitions, who may trigger them, and required evidence live in `core/stateMachine.ts` as a table. No code changes `case.state` except through it. Invalid transitions are rejected and tested.
3. **One owner at a time.** Every open case has an owner (user or role queue) and `dueAt`. Unowned = attention alert.
4. **Closure requires evidence** or an authorized clinician decision. Never auto-close; never close on a bare button click.
5. **Overdue is computed at query time** (`dueAt < clock.now()`), not by timers. A small periodic job only writes escalation events.
6. **Injectable clock.** All time comes from `core/clock.ts`. Admin demo controls can advance simulated time so the overdue scenario is demonstrable and repeatable in seconds.
7. **Escalation is an overlay, not a state.** A case keeps its workflow state and gets `escalationLevel` + an event, and appears in a human queue.
8. **Privacy by design.** Role-scoped queries on the server (never trust the client), notifications contain no clinical detail, reads of patient detail are audited, cross-provider sharing requires a consent record.
9. **Config over code** for SLA durations, message templates and attention rules.

## 6. Case lifecycle (illustrative workflow, not a universal clinical pathway)

Workflow states (Prisma enum `CaseState`):

| State | Owner | Default SLA (illustrative) | Next states | Required to leave |
|---|---|---|---|---|
| NEW | Assigned doctor | 48 h to review | CLINICIAN_REVIEWED | Doctor approves result summary + next step + urgency label |
| CLINICIAN_REVIEWED | Coordinator | 24 h to notify (auto on approval) | CONFIRMATION_PENDING, REFERRAL_PENDING, CLOSED | Notification sent; route chosen by doctor |
| CONFIRMATION_PENDING | Doctor | 7 d | REFERRAL_PENDING, CLOSED | Confirmatory result recorded |
| REFERRAL_PENDING | Coordinator | 3 d for provider to accept | REFERRAL_ACCEPTED, (reassign stays in state) | Receiving provider accepts; rejection forces reassign or escalation |
| REFERRAL_ACCEPTED | Coordinator | 7 d to schedule | APPOINTMENT_SCHEDULED | Appointment date recorded |
| APPOINTMENT_SCHEDULED | Coordinator | until appointment + 2 d | CARE_STARTED, APPOINTMENT_SCHEDULED (reschedule) | Attendance or non-attendance recorded |
| CARE_STARTED | Receiving clinician | follow-up date | CLOSED | Treatment or surveillance plan documented |
| CLOSED | — | — | — | — |

Closure reasons (`ClosureReason`): COMPLETED_CARE, NOT_CONFIRMED, PATIENT_DECLINED, UNREACHABLE_AFTER_ATTEMPTS, TRANSFERRED_OUT.
- COMPLETED_CARE requires an evidence record (attended appointment / care plan).
- Every other reason requires a documented reason **and** clinician sign-off.

Parallel facts tracked as timestamps, not states: `notifiedAt`, `acknowledgedAt`. A patient who does not
acknowledge does NOT block clinical progress, but becomes an attention reason.

Exception rules:
- Referral rejected -> referral status REJECTED, case stays REFERRAL_PENDING, must be reassigned to another provider or escalated.
- Patient unreachable -> contact attempts logged (`ContactAttempt`); after N failed attempts (config) -> escalate; closure only via UNREACHABLE_AFTER_ATTEMPTS with sign-off.
- Missed appointment -> reschedule or escalate; delay reason is mandatory.

SLA numbers are illustrative configuration, not clinical standards. Say so in the docs.

## 7. Data model (Prisma entities; refine in Phase 0 then freeze)

| Entity | Key fields / purpose |
|---|---|
| User | id, email, passwordHash, role, name, providerId?, language |
| Provider | id, name, type (screening centre, hospital, clinic) |
| Patient | id, userId, syntheticMrn, dateOfBirth, preferredLanguage, preferredChannel |
| ScreeningCase | id (CL-####), patientId, pathway, screeningType, resultCategory, resultSummaryApproved, recommendedNextStep, urgencyLabel (clinician-set), state, ownerUserId?, ownerRole?, dueAt, notifiedAt?, acknowledgedAt?, escalationLevel, closureReason?, closedAt?, createdAt |
| CaseEvent | id, caseId, type, fromState?, toState?, actorId, payload json, createdAt (append-only) |
| Evidence | id, caseId, kind, recordedBy, details json, createdAt |
| Referral | id, caseId, fromProviderId, toProviderId, status (PENDING/ACCEPTED/REJECTED), rejectionReason?, createdAt |
| Appointment | id, referralId, scheduledAt, status (SCHEDULED/ATTENDED/MISSED/RESCHEDULED) |
| ContactAttempt | id, caseId, byUserId, channel, outcome, notes, createdAt |
| FollowUp | id, caseId, action, dueAt, status, ownerId |
| Consult | id, caseId, requesterId, targetUserId, kind (PATIENT_TO_CLINICIAN / CLINICIAN_TO_CLINICIAN), question, response?, status |
| Notification | id, caseId, userId, channel, language, templateKey, status, createdAt (mock outbox; no clinical detail) |
| ExplanationDraft | id, caseId, language, text, source (TEMPLATE/LLM), status (DRAFT/APPROVED), approvedBy? |
| Consent | id, patientId, scope, grantedAt, revokedAt? |
| AuditLog | id, actorId, action, entityType, entityId, createdAt (includes sensitive reads) |

## 8. Intelligence layer

### 8.1 Attention / priority engine (rules-based, explainable)
Predicts **operational drop-off risk, not clinical severity**. Always label it: *"Operational workflow rule, not a clinical risk assessment."*
Rules (configurable, each returns a reason string): unassigned case; notification not acknowledged after X h;
referral pending longer than SLA; appointment overdue or missed; follow-up deadline missed; rejected referral not reassigned;
repeated unreachable patient. Output: `attentionLevel` (LOW/MEDIUM/HIGH), list of reasons, suggested operational action.
No ML. Do not add ML unless a decision is logged.

### 8.2 Result explanation (patient-facing)
- Input is ONLY structured, clinician-approved fields (result category, approved summary, next step, urgency label). Never raw data, never free diagnosis.
- Default generator = deterministic localized templates (en/ar). Works with no API key.
- Optional LLM rewrite behind `ExplanationProvider`. Constrained prompt; output must not add diagnoses, drugs, doses, numbers or advice not present in the input; run a simple validator; on failure fall back to the template.
- Saved as `ExplanationDraft`; **a clinician approves before the patient can see it**. Patient sees: explanation, next step, limitations, "this does not replace your clinician".
- Arabic text is machine/template-generated and NOT clinically reviewed: state this in Limitations.

### 8.3 Simulation and analytics
- Seeded random generator creates ~3,000-5,000 synthetic cases across language groups (en, ar, other).
- Compare **baseline** (no tracking: drop-off probability at each hand-off) vs **CareLoop** (stuck cases detected and recovered after SLA breach).
- All probabilities are documented assumptions, NOT empirical. Results show the mechanism's potential, not real-world effect sizes. Say this in `docs/` and on the results page.
- Metrics: time to notification, time to acknowledgement, time to confirmation, time to referral acceptance, appointment completion %, referral completion %, treatment/surveillance initiation %, unresolved actionable cases, documented closure %, delay reasons, breakdown by language group. Dashboard shows live values from the DB; the simulation page shows the cohort comparison.

## 9. Safety, privacy and ethics rules

1. AI never makes or changes clinical decisions. Clinicians approve summaries, next steps and closures.
2. Operational priority is never presented as clinical urgency. Use different labels and colors.
3. All data is synthetic. No real personal data in the repo, logs, screenshots or prompts.
4. Role-based access enforced on the server for every endpoint; patients see only their own cases; cross-provider access needs consent.
5. Notifications and logs never contain diagnosis details.
6. Audit every state change and every read of patient detail.
7. Never expose passwords, tokens or API keys. Secrets only in `.env`.
8. Clinical-sounding text is placeholder content; flag it for human review. Never invent medical guidance.
9. Never claim the prototype is clinically validated.

## 10. Roles and agent workflow

| Who | Responsibility |
|---|---|
| **Owner (human)** | Scope, architecture and schema approval, branch review and merge, running the app, validating workflows, demo and docs ownership |
| **Codex (primary)** | Server, Prisma, auth/RBAC, state machine, workflows, tests, bug fixing |
| **Antigravity (secondary)** | Client UI, dashboards, i18n/RTL, browser verification, Playwright flows, UX review |
| **Claude (reviewer, in chat)** | Spec review, prompt review (hallucination/safety), docs review, test-scenario ideas |

Rules for every agent:
1. Read AGENTS.md and TASKS.md first. Work only on tasks in TASKS.md. New ideas go to the Backlog, not into code.
2. One task = one branch (`task/T-xxx-short-name`) = one PR-sized change. Never two agents on the same files at once.
3. Contract first: API shapes and enums live in `shared/` and `docs/05-API-Documentation.md` before either side implements them.
4. Tests first for state machine, permissions and rules. Run the relevant tests and include the real output in your report.
5. Never claim something works unless you ran it. List anything untested.
6. Do not add dependencies, change the stack, schema or lifecycle without asking; log approved changes in section 15.
7. Keep `docker compose up` working on `main` at all times.
8. Explain non-obvious choices in comments and in `docs/`, in plain language.
9. Draft the matching `docs/` section as you finish each feature.
10. End each task with: what changed, how to run it, what is untested, what is next.

Code quality: validate every request with zod; consistent error format; no unnecessary abstractions; TypeScript strict; no `any` without a comment.

## 11. Documentation deliverables (`docs/`, written continuously)

```
docs/
├── 01-Problem-Statement.md
├── 02-Product-Requirements.md
├── 03-System-Architecture.md
├── 04-Database-Design.md
├── 05-API-Documentation.md      # the contract
├── 06-AI-Design.md              # rules engine, explanation service, safety, simulation method
├── 07-Testing-and-Validation.md # test evidence, simulation results, fairness by language
├── 08-Assumptions-Dependencies-Limitations.md   # REQUIRED by the challenge
└── 09-Setup-and-Deployment.md
```

`08` must state honestly:
- **Assumptions:** synthetic data; simulated providers/labs; clinicians enter or approve clinical content; results already exist; notifications simulated; SLA values illustrative; workflow is a proposal, not a clinical protocol.
- **Dependencies:** Node.js/npm, PostgreSQL, Prisma, Docker, environment variables; optional LLM API and email service (mocked by default); for real deployment: EHR/HIE integration, messaging gateway, identity provider, hosting in the required data-residency boundary.
- **Limitations:** no real integrations or data; no clinical validation; Arabic not clinically reviewed; one pathway modelled; simulation parameters are assumptions; fairness unproven on real populations; not security audited.

## 12. Demo scenario (the one story judges follow)

1. Admin creates (or seeds) a synthetic actionable screening case.
2. Doctor reviews, approves summary and next step, creates a referral. Patient is notified.
3. Patient logs in (en or ar), reads the explanation, acknowledges.
4. Referral sits pending; admin advances the demo clock; the SLA is breached.
5. Coordinator dashboard flags the case as HIGH attention with plain reasons and a suggested operational action.
6. Coordinator contacts the patient, receiving provider accepts, appointment is scheduled and attended.
7. Case closes with evidence; the timeline shows every step and owner; analytics update.

## 13. Acceptance criteria (minimum for submission)

- All four roles can perform their authorized actions.
- A case can travel the full workflow, including one rejected-referral path.
- Unauthorized access to patient data is blocked (tested).
- Invalid transitions and closure without evidence are rejected (tested).
- Overdue / pending / unassigned cases are detected by rules with reasons.
- Every state change and sensitive read is auditable.
- Analytics reflect real database records.
- The demo scenario runs repeatably from seed data, on a fresh machine, via the README.
- `docs/` complete, including section 08.

## 14. Progress log (newest first; update every session)

| Date | Agent/model | Done | Next step |
|---|---|---|---|
| 2026-11-03 | Codex | T-103 patch completed on `task/T-103-state-machine`: clarified closure doctor provider scope with consent checks; retained assigned doctor ownership for confirmation; required actor user ID and named sign-off evidence; made START_CARE follow-up optional with a 30-day default and 180-day bound; added the 2-day appointment grace to §8.2/config; regenerated architecture docs and aligned API documentation. `npm run lint`, `npm run build`, and `npm test` passed (113 tests across four files). | Owner reviews the T-103 patch. |
| 2026-11-03 | Codex | T-103 state machine completed on `task/T-103-state-machine`: centralized routine/urgent SLA and attention configuration; policy table covers every shared transition key; pure evaluator enforces state, role/provider, facts, evidence, consent, delay-reason, sign-off, and conflict rules. Added exhaustive pure-logic tests and generated `docs/03-System-Architecture.md` from the policy table. `npm run lint`, `npm run build`, and `npm test` passed (108 tests). Five interpretation gaps are documented in the architecture doc. | Owner reviews T-103; continue with T-104 case creation/read. |
| 2026-11-03 | Codex | T-101 auth/RBAC completed on `task/T-101-auth-rbac`: fixed Prisma Client generation in the server image, moved dependency construction into `server.ts` with injected `createApp` dependencies, removed test-mode secret substitution, added explicit clock timestamps to seed upserts, renamed Vitest config, and completed the auth flow. Lint, workspace build, 48 unit tests, 18 DB/auth tests on `careloop_test`, Docker startup/logs, seed, health, and live login/logout checks passed. | Owner reviews T-101; continue with T-103 and then T-104. |
| 2026-11-03 | Codex | T-003 contract patch: moved derived transition facts to server validation; transitions now create referrals/appointments; added `expectedState`, review-draft and template-generation request contracts, patient-safe event DTOs, provider and follow-up schemas, tightened auth documentation, and updated endpoint/transition docs plus tests. Shared build and lint pass; all 47 tests pass. `server/prisma/` unchanged. | Owner reviews the patched T-003 contract before implementation begins. |
| 2026-11-03 | Codex | T-003 API contract and shared types completed on `task/T-003-api-contract`: added Prisma-matching Zod enums (including `ActorType` and `FollowUpStatus`), strict DTO/request schemas and inferred types, 25 discriminated lifecycle transition contracts with evidence schemas, role-specific case detail projections, endpoint/permission documentation, and shared plus server enum-parity tests. Verified shared strict `tsc`, lint and all 12 tests pass; lifecycle row count and Prisma enum parity are asserted. Vitest was added because it was not installed. | Owner reviews T-003; then begin dependent implementation tasks. |
| 2026-11-03 | Codex | T-102 completed on `task/T-102-core`: added the persisted injectable clock, append-only event/audit writers with code-level actor checks, atomic transaction helper, `SystemSetting` and seventh additive migration, DB tests, and Compose test instructions. All seven migrations applied to a fresh `careloop_t102_fresh`; the existing `careloop_test` had all seven and reported no pending migrations. Server build, Prisma validation, lint, and all six DB tests passed. A temporary wall-clock violation produced both expected lint errors and was removed. | Owner reviews T-102; continue to T-103 when its dependencies are ready. |
| 2026-11-03 | Codex | T-002 patch: added `ScreeningCase.escalatedAt` and `Referral.respondedAt` with consistency checks in the sixth migration; updated their table descriptions and documented timing uses. Fresh database applied all six migrations; `prisma validate` passed; SQL rechecked append-only triggers. | Owner reviews T-002; proceed to T-003 API contract with escalation and referral response timestamps included. |
| 2026-11-03 | Codex | T-002 patch: added `ActorType` and actor checks to both append-only logs, `FollowUpStatus`, and documented the API/event-payload delay-reason rule. Fresh database applied all five migrations; Prisma validate passed; SQL verified both actor checks and rejected UPDATE/DELETE on both logs. | Owner reviews T-002; proceed to T-003 API contract with the actor, follow-up, and delay-reason vocabulary documented in `docs/04-Database-Design.md`. |
| 2026-11-03 | Codex | T-002 complete on `task/T-002-prisma-schema`: all 15 models and required enums are in `server/prisma/schema.prisma`; four host-persisted migrations include sequence/check constraints and append-only triggers; `docs/04-Database-Design.md` documents the ERD, indexes, seed plan, and spec issues. Fresh-database `prisma migrate dev` applied all four migrations; `prisma validate` passed; SQL rejected UPDATE/DELETE on `CaseEvent` and `AuditLog`. | Owner reviews T-002; define the nullable system actor and follow-up status contract before implementation; continue T-003. |
| 2026-11-03 | Codex | Updated `docs/02-Product-Requirements.md` escalation routing and role definitions; replaced product open questions with owner decisions. Recorded the same decisions below. | Continue with the next approved Phase 0 task. |
| 2026-11-03 | Antigravity | T-001 patched in `docs/02-Product-Requirements.md`: `intakeUrgency`, case creation row & assignment action, full 15-row closure transition table, receiving coordinator queue ownership in `REFERRAL_PENDING`, attention overdue bonus formula & state fallback mapping, strict escalation criteria & admin boundaries, approved explanation gate for `CLINICIAN_REVIEWED`, manual `result_reviewed` dispatch, 9 lifecycle/audit events, consent revocation policy & `consent_needed` template, configuration defaults, DOCTOR/COORDINATOR permission refinement, consolidated visibility scopes, and cohort-defined rate metrics. | Review patched spec; proceed to T-002 (Prisma schema & seed plan). |
| 2026-11-03 | Codex | T-004 scaffold created on `task/T-004-scaffold`: npm workspaces, strict TypeScript, lint/format config, Prisma package and empty module structure, Docker Compose, health endpoint, placeholder page, and README. `docker compose up --build -d` succeeded; `/health` returned HTTP 200 `{"status":"OK"}` and `/` returned HTTP 200 HTML. | Owner reviews T-004; continue Phase 0 tasks T-001 to T-003. |
| 2026-11-03 | Codex | T-001 product requirements draft completed in `docs/02-Product-Requirements.md`; lifecycle, exceptions, roles, attention rules, and metrics align with AGENTS.md sections 6 and 8. | Claude review and owner approval before Phase 0 continues. |
| — | — | Context files created. Nothing built yet. | Start Phase 0 (T-001) |

## 15. Decisions log (update whenever decided or changed)

| # | Decision | Reason |
|---|---|---|
| 1 | Challenge 05 chosen | Engineering-heavy, demonstrable with synthetic data, low clinical risk |
| 2 | Name: CareLoop | Owner decision |
| 3 | Modular monolith: Next.js + Express + PostgreSQL + Prisma, REST, polling | One deployable, familiar tools, enough for scope |
| 4 | No Kafka/Redis/WebSockets/microservices | Solo, 20 days; documented as scale-up path only |
| 5 | Escalation is an overlay on a case, not a state | Avoids state explosion; case keeps its workflow position |
| 6 | Acknowledgement is a timestamp, not a state | Patient inaction must not block clinical progress |
| 7 | Overdue computed at query time with injectable clock | Simple, testable, and demo-able via time advance |
| 8 | Rules-based attention engine, no ML | Synthetic labels would make ML circular; rules are explainable |
| 9 | Explanation = templates first, optional LLM, clinician approval | Safe, works offline, defensible |
| 10 | Event log doubles as timeline and audit | One source of truth |
| 11 | Provider and Consult entities included | Challenge requires cross-provider coordination |
| 12 | English + Arabic (RTL) on patient portal only | Shows linguistic appropriateness at low cost |
| 13 | Product requirements doc mirrors AGENTS lifecycle and analytics rules for T-001 | Keeps the spec aligned with the required workflow, permissions, and measurable outcomes |
| 14 | PostgreSQL is exposed only on the Compose network in the scaffold | The server can reach the database while avoiding a host port conflict; no local DB client access is needed for T-004 |
| 15 | intakeUrgency sets initial review SLA; doctor review confirms urgencyLabel governing all later SLAs | Separates preliminary lab/screening urgency from definitive clinician judgment |
| 16 | Receiving provider's coordinator queue owns REFERRAL_PENDING while sending coordinator retains reassign rights | Ensures intake accountability at the receiving facility while preserving reassignment authority |
| 17 | ADMIN may assign owner to unassigned cases but cannot resolve escalations | Keeps clinical and operational escalation governance with clinicians and coordinators |
| 18 | Rate metrics restricted to cases created > 30 days ago or closed cases | Eliminates right-censoring bias from active/recent cases |
| 19 | LEVEL_1 routes to the COORDINATOR queue; LEVEL_2 routes to the DOCTOR and COORDINATOR queues; LEVEL_3 routes to the DOCTOR queue, including the originating doctor, and sends an ADMIN notification | Escalation routing names accountable roles without introducing additional role types |
| 20 | Demo pathway is “Adult comprehensive screening, abnormal finding” | Provides one consistent illustrative pathway for the demo |
| 21 | Local Docker is the primary hosting path, decided on Day 18 | Keeps the primary run path reproducible and aligned with the project setup |
| 22 | Explanation output is template-only by default; an optional provider remains behind the interface | Provides safe, deterministic behavior without requiring an external service |
| 23 | Notifications use one in-app center with a simulated channel label | Keeps delivery within the prototype scope while showing channel metadata |
| 24 | Arabic explanations show an inline banner and footer note stating the text is not clinically reviewed | Makes the translation limitation visible where patients read the explanation |
| 25 | `ActorType` distinguishes `USER` and `SYSTEM`; user actors require an actor ID while system actors may omit it | Preserves attribution without assigning automated actions to a person |
| 26 | Follow-up status values are `OPEN`, `COMPLETED`, and `CANCELLED` | Gives the follow-up lifecycle a fixed API/database vocabulary |
| 27 | Appointment delay reason is nullable; overdue corrective actions require the API to record the reason in `DELAY_REASON_RECORDED` payload | Keeps contextual reasons optional on appointments and records corrective-action rationale in the immutable timeline |
| 28 | `ScreeningCase.escalatedAt` tracks time above `LEVEL_0`, and `Referral.respondedAt` timestamps acceptance/rejection | Supports the LEVEL_3 uncleared-escalation timer, rejected-referral reassignment window, and time-to-referral-acceptance metric |
| 29 | List `updatedAt` is the response snapshot timestamp where append-only records have no row-level update timestamp | Preserves immutable event/audit rows while making each list response freshness explicit; documented as a spec interpretation in the API contract |
| 30 | Both exits from `CLINICIAN_REVIEWED` require a sent `result_reviewed` notification; the patient-declined closure from that state does not | Matches the notification dispatch requirement to the two forward workflow paths without blocking the explicit decline closure |
| 31 | `SystemSetting` stores the demo-clock offset as a millisecond JSON value under a stable key and serves as the keyed store for admin configuration | Keeps simulated time across server restarts and gives future configuration reads and writes one persisted store |
| 32 | `@prisma/client` is approved as a server runtime dependency for typed transaction access and database-backed core tests | The core writers and integration tests use generated Prisma Client APIs |
| 33 | Login failures return `RATE_LIMITED` after five failures in a 15-minute email/IP window; the limiter is process-local | Gives the prototype predictable abuse control without an additional shared store; multi-instance deployments need a shared limiter |
| 34 | JWT timestamps, cookie lifetime, and login throttling use `core/realTime.ts`; workflow and audit timestamps use the injectable demo clock | Simulated time must not change security-session validity or abuse-control windows |
| 35 | Authentication reloads the user row on every request | Role changes and deleted user accounts take effect immediately for existing session tokens |
| 36 | Workflow transition policy and its routine/urgent SLA and attention configuration are centralized in typed data tables; architecture transition documentation is generated from that policy table | Keeps evaluation behavior, tests, and documented transition mapping tied to one inspectable source |
| 37 | Before referral, closure is limited to the originating provider's DOCTOR; during referral/appointment workflow either the originating or receiving DOCTOR may close with active consent required for cross-provider closure; during care only the receiving DOCTOR may close | Keeps closure authority aligned with the provider responsible at each point in the care pathway |
| 38 | CONFIRMATION_PENDING is owned by the assigned doctor, falling back to the origin provider's DOCTOR queue | Preserves individual accountability when an assigned clinician exists while ensuring a queue owner otherwise |
| 39 | Evaluator actors always include the authenticated user ID, and CLOSE_* derives sign-off evidence naming that user and the supplied clock time | Makes clinician authorization auditable and explicit in the pure evaluation result |
| 40 | START_CARE followUpAt is optional with a 30-day default; a supplied date must be within the next 180 days | Supports a standard follow-up while allowing clinician-selected timing within a bounded window |
| 41 | Appointment attendance grace is configured as 2 days for routine and urgent cases and is added to the scheduled appointment time | Makes the documented attendance SLA explicit and centralizes the dueAt rule |

## 16. Resolved decisions

- Pathway: Adult comprehensive screening, abnormal finding.
- Hosting: Decided on Day 18; local Docker is the primary path.
- LLM: Template-only by default; optional provider behind the interface.
- Outbox: One in-app notification center with a simulated channel label.
- Arabic: Inline banner on the explanation plus a footer note; not clinically reviewed.

## 17. Resuming with a different model

Read sections 1, 3-6, 10, then the latest rows of 14 and 15, then `TASKS.md`, then `git log` and the test results.
Continue from the first unfinished task. Do not redesign anything already decided.
