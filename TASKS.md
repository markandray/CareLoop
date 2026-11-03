# TASKS.md — CareLoop task board

> Agents: work ONLY on tasks listed here. Pick the first unfinished task whose dependencies are done and that is assigned to you.
> New ideas go to the Backlog (bottom), never straight into code.
> Mark a task `[x]` only when its acceptance criteria are met AND you have pasted real evidence (test output, commands run) in your report.
> Update the Progress log in AGENTS.md at the end of every session.

Legend: **Codex** = backend/primary, **Antigravity** = frontend/secondary, **Claude** = review in chat, **Owner** = human.
Branch naming: `task/T-xxx-short-name`. Owner reviews and merges.

---

## Phase 0 — Foundation (Days 1-2). NO feature code until T-001 to T-003 are approved by the Owner.

### [x] T-001 Product spec and lifecycle table
- Agent: Codex (draft) -> Claude (review) -> Owner (approve)
- Output: `docs/02-Product-Requirements.md` containing the final lifecycle table (state, owner role, SLA, allowed transitions, who may trigger, required evidence, notifications), exception rules, role/permission matrix, attention rules list, metrics list with exact formulas.
- Accept: matches AGENTS.md sections 6 and 8; every transition has an owner and evidence rule; open questions listed at the end.

### [x] T-002 Prisma schema and seed plan
- Agent: Codex. Depends: T-001
- Output: `server/prisma/schema.prisma`, first migration, `docs/04-Database-Design.md` (ER diagram + why each table exists).
- Accept: migration runs on a clean database; all entities in AGENTS.md section 7 present; `CaseEvent` has no update/delete code path.
- T-002 follow-up patches: actor attribution uses `ActorType`, follow-ups use `FollowUpStatus`, delay reasons are recorded on corrective-action events, and the sixth migration adds escalation/referral response timestamps with checks; fresh six-migration run and append-only SQL checks passed (see AGENTS.md Progress log).

### [x] T-003 API contract and shared types
- Agent: Codex. Depends: T-001
- Output: `shared/` (enums, DTO types, zod schemas) and `docs/05-API-Documentation.md` listing every endpoint (method, path, roles allowed, request, response, errors).
- Accept: Owner approves; frontend and backend will both import from `shared/`.
- Evidence (2026-11-03): strict shared TypeScript build, ESLint, and Vitest pass; all lifecycle rows map one-to-one to transition keys; server test confirms shared Zod enum parity with Prisma. Vitest was absent and added as a root dev dependency. Owner branch review remains pending.
- T-003 patch evidence (2026-11-03): removed client-supplied derived transition facts, added `expectedState`, review draft/generation, safe event projections, provider/follow-up contracts, tightened authentication and updated route docs. Shared build and lint pass; 47 tests pass. No Prisma files or routes changed.

### [x] T-004 Repo scaffold
- Agent: Codex. Depends: none (can run in parallel with T-001)
- Output: npm workspaces (`client`, `server`, `shared`), TypeScript strict, ESLint/Prettier, `docker-compose.yml` (postgres, server, client), `.env.example`, README with run steps, empty module folders per AGENTS.md section 5.
- Accept: `docker compose up` starts all three; health endpoint returns OK; client loads a placeholder page.

### [ ] T-005 First draft of docs 01 and 08
- Agent: Claude (draft) / Owner (edit)
- Output: `docs/01-Problem-Statement.md`, `docs/08-Assumptions-Dependencies-Limitations.md` (first draft from AGENTS.md section 11).
- Accept: three headings present: Assumptions, Dependencies, Limitations.

---

## Phase 1 — Backend foundation (Days 3-5)

### [x] T-101 Auth and RBAC
- Agent: Codex. Depends: T-002, T-003
- Output: register/login/logout/me, bcrypt, JWT httpOnly cookie, `auth` and `role` middleware, seed of demo users (patient, 2 doctors in different providers, coordinator, admin).
- Accept: tests prove each role is allowed/denied on a sample route; passwords never returned; invalid token rejected.
- Evidence (2026-11-03): 48 unit tests and 18 Compose DB/auth tests passed; `npm run lint` and `npm run build` passed. Fresh `docker compose up --build -d` generated Prisma Client in the image; `/health`, wrong/right password login, cookie-backed `/auth/me`, logout, and post-logout 401 were verified. Seed and run commands are in README.

### [x] T-102 Clock, event log and audit core
- Agent: Codex. Depends: T-002
- Output: `core/clock.ts` (injectable, persisted offset), `core/eventLog.ts` (append-only writer), `core/audit.ts`, and a shared transaction helper.
- Accept: clock persistence, append/rollback, append-only database triggers, and actor constraints verified by the Compose-backed core tests; ESLint forbids direct wall-clock reads outside `core/clock.ts`.

### [x] T-103 State machine module
- Agent: Codex. Depends: T-001, T-102
- Output: `core/stateMachine.ts` as a transition table with actor-role rules and required evidence; unit tests.
- Accept: every allowed transition tested; every disallowed transition rejected with a clear error; closure without evidence rejected; non-completed closure without clinician sign-off rejected.
- Evidence (2026-11-03): centralized workflow SLA/attention configuration, a table covering every shared transition key, and a pure evaluator are committed. Generated architecture diagram and transition table via `npm run docs:state-machine`. `npm run lint`, `npm run build`, and `npm test` passed; Vitest reports 108 tests across four files. Ambiguous policy interpretations are documented as spec issues in `docs/03-System-Architecture.md`.
- T-103 clarification patch (2026-11-03): closure provider rules, CONFIRMATION_PENDING assigned owner, required user-attributed sign-off evidence, optional bounded START_CARE follow-up, and the 2-day appointment grace were implemented, tested, documented, and committed in numbered steps. Resolved decisions moved into `docs/03-System-Architecture.md` and AGENTS.md Decisions. `npm run lint`, `npm run build`, and all 113 tests passed.

### [x] T-104 Patients and cases (create/read)
- Agent: Codex. Depends: T-101, T-102
- Output: create case (doctor/admin), list/get with role-scoped visibility, assignment, case id format `CL-####`.
- Accept: patient sees only own cases; doctor/coordinator see own-origin-provider cases; out-of-scope cases return 404; disallowed create roles return 403; sensitive reads audited.
- Evidence (2026-11-03): T-104a and T-104b are complete. `npm run lint`, `npm run build`, `npm test` (108), and `npm run test:db` (37; all pass) passed. HTTP DB tests cover create/read visibility, patient-safe events, coordinator redaction, pagination, strict validation, origin checks, and read audit. Rebuilt Compose services, seeded synthetic data, and verified curl POST 201, GET 200, and cross-provider GET 404.

#### [x] T-104a Case data layer
- Agent: Codex. Depends: T-101, T-102, T-103
- Output: case visibility scopes, zod-validated role projections, transaction-backed create/list/get/event data service, and Compose DB tests. No routes are included.
- Evidence (2026-11-03): `npm run lint`, `npm run build`, `npm test` (108 tests), and `npm run test:db` (29 tests) pass. DB suite confirmed case visibility, redacted DTOs/events, atomic writes/rollback, stable keyset pagination, and read audits. Receiving-provider access remains for T-201; authenticated routes were added in T-104b.

#### [x] T-104b Case routes
- Agent: Codex. Depends: T-104a, T-101
- Output: authenticated case create/list/detail/event routes and HTTP integration tests.
- Evidence (2026-11-03): added strict shared-schema routes under `/api/v1/cases`, mounted behind authentication, and added Compose DB HTTP tests. The tests also exposed and fixed Express 5 query getter mutation in validation middleware. See the T-104 evidence above for commands and live curl results.

### [ ] T-105 Case transitions endpoint
- Agent: Codex. Depends: T-103, T-104
- Output: `POST /cases/:id/transitions` applying the state machine, setting owner and `dueAt` from SLA config, writing events.
- Accept: integration tests walk the full happy path; owner and `dueAt` change correctly at each step.
- T-105a service-layer evidence (2026-11-04): transition fact loading, row-locked atomic execution, referral/appointment/evidence/event/notification/audit writes, and active-consent receiving-provider packet projection are implemented. Lint, build, unit tests (113), and DB tests (42) pass. T-105 remains open because the HTTP transitions endpoint and its route integration are still outstanding.

---

## Phase 2 — Healthcare workflow (Days 6-8)

### [ ] T-201 Providers and referrals
- Agent: Codex. Depends: T-105
- Output: create referral, receiving provider accept/reject (reason required), reassign to another provider.
- Accept: rejected referral cannot be ignored (case flagged until reassigned/escalated); events written; permissions tested.

### [ ] T-202 Appointments, contact attempts, delay reasons, follow-ups
- Agent: Codex. Depends: T-201
- Output: schedule/reschedule/mark attended or missed; log contact attempts; mandatory delay reason on overdue actions; follow-up items.
- Accept: missed appointment path tested; contact attempts counted toward unreachable rule.

### [ ] T-203 Notifications outbox and acknowledgement
- Agent: Codex. Depends: T-105
- Output: notification created on clinician approval and key changes (no clinical detail in text), patient acknowledge endpoint sets `acknowledgedAt`, in-app list.
- Accept: acknowledgement does not change workflow state; notification text contains no diagnosis details (test).

### [ ] T-204 Consults
- Agent: Codex. Depends: T-104
- Output: patient->clinician and clinician->clinician consult request, response, status; visible on case timeline.
- Accept: only permitted roles can create/answer; events written.

### [ ] T-205 Attention rules engine and escalation job
- Agent: Codex. Depends: T-201, T-202, T-203
- Output: `modules/attention` with configurable rules returning reasons + suggested operational action; `attentionLevel` on case queries; periodic job writes escalation events and sets `escalationLevel`.
- Accept: each rule has a unit test; reasons are plain-language; response includes the label "operational workflow rule, not a clinical risk assessment".

### [ ] T-206 Consent and cross-provider access
- Agent: Codex. Depends: T-104
- Output: consent create/revoke; cross-provider case access requires active consent; consent changes audited.
- Accept: access denied after revocation (test); audit entries present.

---

## Phase 3 — Frontend (Days 9-11). Starts after T-003 is approved; can begin on mocked data earlier.

### [ ] T-301 App shell, login, role routing, i18n and RTL
- Agent: Antigravity. Depends: T-003, T-101
- Output: login page, role-based routes/layout, en/ar switching with proper RTL, shared UI components.
- Accept: each role lands on its own area; unauthorized routes redirect; Arabic renders RTL without layout breakage (screenshots).

### [ ] T-302 Patient portal
- Agent: Antigravity. Depends: T-301, T-203
- Output: case list, status tracker, plain-language explanation, next step, "I understand" button, notifications, referral/appointment status, consult request.
- Accept: works in English and Arabic; no clinical jargon in notifications; mobile-responsive.

### [ ] T-303 Doctor dashboard
- Agent: Antigravity. Depends: T-301, T-105, T-201
- Output: worklist, case detail, approve summary/next step/urgency, create referral, accept/reject incoming referral, answer consults, sign off closures.
- Accept: doctor cannot see other providers' unconsented cases.

### [ ] T-304 Coordinator dashboard
- Agent: Antigravity. Depends: T-301, T-205
- Output: attention queue with reasons and suggested actions, contact log form, schedule appointment, delay reason, escalate, close with evidence.
- Accept: HIGH attention cases sorted first; closure form requires evidence.

### [ ] T-305 Case timeline component
- Agent: Antigravity. Depends: T-301, T-105
- Output: reusable timeline from `CaseEvent` showing actor, owner, state, timestamps, evidence; used on all roles' case pages (with role-appropriate detail).
- Accept: matches event log exactly.

### [ ] T-306 Admin dashboard and demo controls
- Agent: Antigravity + Codex (demo endpoints). Depends: T-301, T-403
- Output: KPI cards, stuck-cases view, case creation, user list, demo clock "advance time" and "reset demo data" controls.
- Accept: demo controls only available to ADMIN and disabled via env flag in production mode.

---

## Phase 4 — Intelligence and analytics (Days 12-14)

### [ ] T-401 Explanation service
- Agent: Codex. Depends: T-104
- Output: `modules/explanation` with template generator (en/ar), `ExplanationProvider` interface, optional LLM provider (off by default), output validator, fallback to template.
- Accept: works with no API key; validator rejects added diagnoses/drugs/numbers (tests); output stored as `ExplanationDraft`.

### [ ] T-402 Clinician approval of explanation
- Agent: Codex (API) + Antigravity (UI). Depends: T-401, T-303
- Accept: patient cannot see an unapproved explanation (test); approval is audited.

### [ ] T-403 Analytics endpoints
- Agent: Codex. Depends: T-205
- Output: totals by state, awaiting notification, pending referrals, overdue, closed; averages for time to notification/referral/closure; referral completion %, closure %.
- Accept: numbers verified against hand-counted seed data.

### [ ] T-404 Synthetic cohort and simulation
- Agent: Codex. Depends: T-403
- Output: seeded generator (~3,000-5,000 cases, language groups), baseline vs CareLoop runs, results JSON, method documented in `docs/06-AI-Design.md`.
- Accept: reproducible with a fixed seed; assumptions listed; results include breakdown by language group.

### [ ] T-405 Simulation results page
- Agent: Antigravity. Depends: T-404, T-301
- Accept: charts with before/after, visible banner "synthetic data; parameters are assumptions".

---

## Phase 5 — Integration and testing (Days 15-16)

### [ ] T-501 End-to-end demo test
- Agent: Antigravity (Playwright). Depends: all of Phases 1-4
- Accept: the demo scenario (AGENTS.md section 12) runs end to end from a freshly seeded database, in English and once in Arabic.

### [ ] T-502 Authorization and privacy test suite
- Agent: Codex
- Accept: matrix test over roles x endpoints; patient isolation; consent revocation; no clinical detail in notifications/logs.

### [ ] T-503 Invalid-state and edge-case tests
- Agent: Codex
- Accept: invalid transitions, double actions, missing evidence, rejected referral loops, unreachable patient path.

### [ ] T-504 Bug fixing and UX pass
- Agent: both. Owner decides priorities.

### [ ] T-505 Accessibility and RTL check
- Agent: Antigravity
- Accept: keyboard navigation on main flows, contrast ok, Arabic layout reviewed.

---

## Phase 6 — Technical documentation (Days 17-18). Most files should already be drafted.

### [ ] T-601 Finalize docs 02-07 and 09
- Agent: Codex/Claude (draft) -> Owner (edit and own)
- Accept: architecture diagram, ER diagram, API reference matches code, test evidence and simulation results pasted into 07, setup steps verified.

### [ ] T-602 Finalize doc 08 (assumptions, dependencies, limitations)
- Agent: Owner with Claude review
- Accept: covers every item in AGENTS.md section 11; no claim of clinical validation anywhere.

---

## Phase 7 — Release (Days 19-20)

### [ ] T-701 Fresh-machine test
- Owner: clone, follow README only, run `docker compose up`, seed, run demo scenario. Fix every break.

### [ ] T-702 Deployment
- Agent: Codex. Accept: live URL works with demo accounts; secrets not in repo.

### [ ] T-703 Demo data and accounts
- Accept: seed script creates demo users and cases at varied stages; credentials listed in README.

### [ ] T-704 Screenshots and optional short demo recording
- Owner. Accept: images in `docs/`; not required by the challenge, only if time remains.

### [ ] T-705 Submission checklist
- Owner. Prototype link/repo, technical documentation, assumptions/dependencies/limitations statement; final smoke test; submit.

---

## If you fall behind: cut in this order
1. LLM explanation provider (keep templates only)
2. Simulation results page polish (keep numbers in docs)
3. Consult feature simplified to a question/answer thread
4. Hosted deployment (keep reliable local Docker run)
5. Playwright (keep manual test checklist)

**Never cut:** state machine, evidence-gated closure, audit trail, RBAC and privacy tests, the demo scenario, doc 08.

## Backlog (not approved; do not build without Owner approval)
- Real email notifications
- LLM provider integration beyond the interface
- ML follow-up prediction (only if suitable real data exists)
- WhatsApp/SMS gateways
- Mobile app
