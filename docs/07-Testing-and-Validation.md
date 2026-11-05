# Testing and Validation

## T-102 — Core clock, event log, and audit

- `clock advance, reset, and persistence across a new instance` proves the simulated clock persists and resets.
- `appendEvent writes an append-only CaseEvent row` proves event actor and time are recorded through the injected clock.
- `record appends an AuditLog row` proves audit attribution and time are persisted.
- `a failed audit write rolls back its event in the same transaction` proves event and audit transaction atomicity.
- `database triggers reject update and delete on CaseEvent` proves database append-only enforcement.
- `USER actor without actorId is rejected in code and by PostgreSQL` proves user attribution cannot be omitted.

## T-101 — Authentication and RBAC

- `login success: returns 200, user session, sets session cookie, and records audit log` proves successful login behavior.
- `identical failure for unknown email vs wrong password (shape, code, timing-safe)` proves login failures do not reveal account existence.
- `cookie flags: httpOnly, SameSite=Strict, Path=/` proves session cookie protections.
- `/auth/me: returns user session when authenticated; 401 when not authenticated` proves session lookup and unauthenticated rejection.
- `logout clears the cookie and audits LOGOUT` proves logout invalidates the browser cookie and is audited.
- `requireRole matrix over all four roles on test routes` proves role middleware allows only configured roles.
- `a token whose user was deleted is rejected (reloaded from DB)` proves deleted accounts lose access immediately.
- `login rate limit: 5 failed attempts per 15 min per email+IP, then 429 RATE_LIMITED` proves failed login throttling.
- `a cross-origin state-changing POST is rejected; matching origin and curl (no origin) allowed` proves origin policy behavior.
- `the app refuses to start without JWT_SECRET (or when < 32 characters)` proves auth secret validation.
- `passwordHash never appears in any response` proves password hash privacy.
- `rejects non-JSON content type on write requests` proves write request content-type validation.

## T-104 — Case creation and reads

- `case visibility limits patients to their profile and clinicians to origin provider; admins see all` proves role and provider case scoping.
- `coordinator DTO contains no clinical result summary` proves coordinator case projection privacy.
- `patient event DTO contains no payload or actor identifiers` proves patient timeline privacy.
- `createCase writes case, intake evidence, event, and audit with sequence ID and clock timestamps` proves atomic case creation and timestamp use.
- `case creation rolls back all writes when the audit writer fails` proves case creation atomicity.
- `doctor cannot create a case for another provider` proves doctor creation scope.
- `admin may create for any provider and an unassigned case remains unassigned` proves admin creation and unassigned behavior.
- `keyset pagination returns stable pages for equal creation timestamps` proves case list cursor stability.
- `event cursor pagination returns stable pages when timestamps tie` proves event cursor stability.
- `case, case list, and event reads are audited` proves sensitive case reads are logged.
- `patient projection never includes a DRAFT explanation` proves unapproved explanations stay hidden.
- `unauthenticated request is rejected and patients cannot create cases` proves route authentication and role enforcement.
- `doctor creates and reads a case; another provider receives 404` proves HTTP case scope and concealment.
- `coordinator case detail excludes clinical summary keys throughout JSON` proves nested HTTP projection privacy.
- `patient event response contains no payload or actor ID keys` proves patient event response privacy.
- `admin can see cases from both providers` proves admin case visibility.
- `cursor pages are stable and non-overlapping` proves HTTP pagination behavior.
- `invalid create body returns 400 VALIDATION_ERROR and cross-origin write returns 403` proves request validation and origin checks.
- `GET case writes a sensitive-read audit row` proves HTTP case detail read auditing.

## T-105 — Transitions and referrals

- `full referral-to-care path persists state, owner, dueAt, events, and receiving packet` proves the referral through care lifecycle.
- `rejected referral reassignment supersedes the old row and resets ownership and SLA` proves reassignment semantics.
- `rescheduling allows SCHEDULED or MISSED only and preserves prior status semantics` proves appointment rescheduling rules.
- `wrong role, stale state, missing closure fact, and coordinator closure write nothing` proves transition failures are non-mutating.
- `case row lock permits exactly one of two identical concurrent transitions` proves transition concurrency control.
- `audit failure rolls the transition back atomically` proves transition write atomicity.
- `every transition key persists the evaluator outcome and exactly its owned rows` proves persistence matches the policy table for all 24 non-creation transition keys.
- `REVIEW_CASE` proves review state, ownership, SLA, events, evidence, notification, and audit output.
- `REQUEST_CONFIRMATION` proves confirmation request state, ownership, SLA, events, notification, and audit output.
- `CREATE_REFERRAL_FROM_REVIEW` proves reviewed referral creation and ownership output.
- `CLOSE_AFTER_REVIEW_PATIENT_DECLINED` proves review-stage decline closure evidence and sign-off.
- `CREATE_REFERRAL_AFTER_CONFIRMATION` proves post-confirmation referral creation.
- `CLOSE_NOT_CONFIRMED` proves non-confirmed closure evidence and sign-off.
- `CLOSE_CONFIRMATION_PATIENT_DECLINED` proves confirmation-stage decline closure evidence and sign-off.
- `CLOSE_CONFIRMATION_UNREACHABLE` proves confirmation-stage unreachable closure evidence and sign-off.
- `ACCEPT_REFERRAL` proves provider acceptance facts, status, owner, and SLA.
- `REASSIGN_REFERRAL` proves replacement referral and previous referral supersession.
- `CLOSE_REFERRAL_PATIENT_DECLINED` proves pending-referral decline closure evidence and sign-off.
- `CLOSE_REFERRAL_UNREACHABLE` proves pending-referral unreachable closure evidence and sign-off.
- `CLOSE_REFERRAL_TRANSFERRED_OUT` proves pending-referral transfer closure evidence and sign-off.
- `SCHEDULE_APPOINTMENT` proves appointment creation and receiving queue ownership.
- `CLOSE_ACCEPTED_REFERRAL_PATIENT_DECLINED` proves accepted-referral decline closure evidence and sign-off.
- `CLOSE_ACCEPTED_REFERRAL_UNREACHABLE` proves accepted-referral unreachable closure evidence and sign-off.
- `CLOSE_ACCEPTED_REFERRAL_TRANSFERRED_OUT` proves accepted-referral transfer closure evidence and sign-off.
- `START_CARE` proves care start and follow-up creation.
- `RESCHEDULE_APPOINTMENT` proves replacement appointment and delay reason event.
- `CLOSE_SCHEDULED_PATIENT_DECLINED` proves scheduled-stage decline closure evidence and sign-off.
- `CLOSE_SCHEDULED_UNREACHABLE` proves scheduled-stage unreachable closure evidence and sign-off.
- `CLOSE_SCHEDULED_TRANSFERRED_OUT` proves scheduled-stage transfer closure evidence and sign-off.
- `CLOSE_COMPLETED_CARE` proves care completion evidence and sign-off.
- `CLOSE_CARE_TRANSFERRED_OUT` proves care-stage transfer closure evidence and sign-off.
- `confirmation route can close NOT_CONFIRMED or proceed to referral after confirmation` proves both confirmation outcomes.
- `receiving-provider transition response never contains clinical or origin-only content at any depth` proves receiving response minimization.
- `HTTP happy journey uses each provider role and receiving DTO remains a ReferralPacket` proves routed lifecycle access and packet projection.
- `HTTP rejected referral path can be reassigned` proves rejected referral recovery over HTTP.
- `route returns every transition error status and code` proves HTTP transition error mapping.
- `two concurrent identical transition requests return one 200 and one 409` proves HTTP transition serialization.

## T-206 — Consent, providers, and staff privacy

- `patient grants consent, and listing returns it` proves consent grant and patient list behavior.
- `patient revokes consent and revokedAt is set` proves revocation is timestamped without overwriting the row.
- `double revoke returns 409` proves repeated revocation is rejected.
- `duplicate active grant for the same provider and scope returns 409` proves active grant uniqueness behavior.
- `another patient's consent id returns 404` proves patient consent ownership concealment.
- `doctor, coordinator and admin get 403 on the consent endpoints` proves consent routes are patient-only.
- `consent events appear on open cases and not on CLOSED ones, and an audit row is written` proves consent timeline and audit writes.
- `revoke raises LEVEL_1 only for active referrals to that provider, and never lowers a higher level` proves targeted escalation behavior.
- `receiving-provider case read, referral packet and transition are denied after revoke and allowed after a new grant` proves immediate access revocation and restoration.
- `GET /providers returns the directory with the cursor contract` proves provider directory paging.
- `GET /providers/:id/staff returns no email or password fields` proves staff directory privacy.

## T-203 — Notifications, acknowledgement, and understanding

## T-401b — Review draft and explanation API (partial; HTTP scenario tests pending)

- `npm run lint` passed after the API and migration changes.
- Root `npm run build` passed for Next.js, server TypeScript, and shared TypeScript.
- `npm test`: 5 test files passed, 124 passed, 0 failed.
- `npm run test:db`: 68 top-level TAP tests, 3 suites, 123 tests, 123 passed, 0 failed; migrations `20261104030000_explanation_input_hash` and `20261104040000_explanation_history_index` were applied to `careloop_test`.
- `patient case detail separates a safe clinician note from explanation text` verifies a safe note is not embedded in serialized patient-facing text and is separately labelled.
- `patient case detail suppresses clinician notes containing digits or denylist terms` verifies unsafe clinician note text is omitted from the patient-facing DTO.
- `T-401b HTTP journey creates case, drafts, approvals, review, dispatch, acknowledgement, explanation read, and understanding` covers the requested HTTP-created first-half demo journey.
- `T-401b generate rejects an incomplete review draft with 422 EVIDENCE_MISSING` covers incomplete draft handling.
- `T-401b patients and coordinators receive 403 for draft, generate, and approve actions` covers role denials.
- `T-401b doctor from another provider receives 404 for draft, generation, and approval` covers provider scoping and concealment.
- `T-401b patient explanation list never returns a DRAFT row` covers patient draft filtering.
- `T-401b coordinator sees only approved current explanations without case clinical fields` covers coordinator filtering and minimization.
- `T-401b origin doctor sees stale explanation history with current labels` covers doctor history visibility.
- `T-401b changed draft generation creates a new bilingual pair and retains old rows` covers stale history and same-timestamp generation.
- `T-401b editing a review draft makes approvals stale and REVIEW_CASE fail` covers stale approval invalidation, patient stale filtering, and transition evidence.
- `T-401b approving an already approved explanation returns 409 CONFLICT` covers repeat approval.
- Live Compose curl against seeded synthetic accounts: case create 201; doctor draft save 200; generate 200; EN approve 200; AR approve 200; `REVIEW_CASE` 200; coordinator notification list and dispatch 200; patient notification list and acknowledgement 200; patient explanation list and understanding confirmation 200.
- A first live draft-save attempt exposed the existing complete-draft check constraint; draft save was corrected to also persist catalog-derived legacy summary fields and the walkthrough then passed.
- No dedicated named T-401b HTTP journey tests were added in this partial delivery. Missing evidence includes route-specific permissions/provider concealment, idempotency, stale drafts and approvals, incomplete draft, patient filtering, and sensitive-read audit scenarios. The live walkthrough was successful but does not replace those tests.

- `every notification template is neutral in EN and AR with no clinical terms or digits` proves all 13 catalog entries pass the denylist and digit scan.
- `an automatic NOTIFICATION_SENT event does not satisfy result_reviewed dispatch evidence` proves the evaluator requires the exact review template key.
- `automatic referral_started is SENT with its transition in one transaction` proves the referral transition commits with its automatically sent notification and event.
- `automatic notification write failure rolls its transition back` proves a notification writer failure rolls back transition state and owned rows.
- `notification DTOs omit clinical review claims and use language review notices` proves no returned notification DTO has `clinicallyReviewed`, with `UNREVIEWED_TRANSLATION` for Arabic and `NONE` for EN/OTHER.
- `Arabic notification DTO carries the unreviewed translation notice` proves Arabic DTOs carry the explicit unreviewed-translation notice.
- `coordinator notification list is limited to cases at their provider` proves staff notification scope.
- `admin can list notifications across providers` proves admin notification visibility.
- `origin coordinator dispatches result_reviewed and writes sent event, timestamp, and audit` proves dispatch authorization and atomic send records.
- `dispatch requires an approved explanation and returns 422 EVIDENCE_MISSING` proves the explanation prerequisite.
- `dispatching a notification twice returns 409 CONFLICT` proves duplicate dispatch rejection.
- `only the case origin coordinator may dispatch its result_reviewed notification` proves dispatch provider scoping.
- `patient role receives 403 when dispatching a notification` proves patient dispatch denial.
- `acknowledging result_reviewed sets acknowledgedAt and preserves workflow state` proves the initial notification sets the case timestamp while preserving workflow state.
- `acknowledging consent_needed writes its event and audit but leaves acknowledgedAt null` proves an automatic notification is acknowledged without changing the case timestamp.
- `later automatic notification acknowledgement is audited without changing the initial timestamp` proves later acknowledgements remain recorded after the initial timestamp is set.
- `dispatch sets notifiedAt once and a later automatic notification preserves it` proves later automatic sends cannot overwrite the first sent timestamp.
- `doctor role receives 403 when acknowledging a notification` proves staff acknowledgement denial.
- `repeated patient acknowledgement returns 409 CONFLICT` proves duplicate acknowledgement rejection.
- `patient cannot see another patient notification in their notification list` proves patient list isolation.
- `patient cannot read another patient notification and receives 404` proves direct notification read concealment.
- `patient cannot acknowledge another patient notification and receives 404` proves patient acknowledgement concealment.
- `approved understanding confirmation does not change workflow state` proves understanding confirmation state invariance.
- `understanding rejects an explanation belonging to a different case` proves explanation ownership validation.
- `consent request automatically sends consent_needed and records its event` proves the consent request notification path.
- `consent request from another provider cannot target an origin case` proves consent request provider authorization.

All database HTTP tests run with `node:test` against PostgreSQL through `npm run test:db`; they use synthetic fixtures. The API tests exercise the Express application in-process. No live external notification delivery is performed; `SENT` means the in-app outbox row was dispatched.

## T-202a — Referral rejection, attendance, and contact attempts

- `npm run lint` passed.
- Root `npm run build` passed for Next.js, server TypeScript, and shared TypeScript. Next.js printed its existing ESLint plugin configuration warning.
- `npm test`: 5 test files passed, 124 passed, 0 failed.
- `npm run test:db`: 68 top-level TAP tests across 3 suites; 141 tests, 141 passed, 0 failed. Migration `20261104050000_appointment_attended_at` applied to `careloop_test`.
- `T-202a concurrent identical explanation generation leaves exactly one EN and one AR draft` verifies row-lock serialization.
- `T-202a receiving coordinator rejection records response and returns ownership to the origin queue`, `T-202a referral rejection is forbidden to the origin coordinator`, `T-202a rejected referral cannot be rejected twice`, and `T-202a unrelated provider cannot reject a referral` verify referral status, permissions, timing, event, and audit behavior.
- `T-202a rejected referral can be reassigned and resets receiving owner and SLA` verifies hand-back followed by reassignment.
- `T-202a ATTENDED records timestamp, event, audit and 24 hour recovery deadline without starting care`, `T-202a MISSED records reason events and urgent four hour recovery deadline`, `T-202a MISSED without delayReason returns 422 DELAY_REASON_REQUIRED`, `T-202a attendance is denied to origin coordinator`, and `T-202a attendance on an appointment that is no longer scheduled returns 409` cover attendance outcomes, authorization, and state conflicts.
- `T-202a contact attempt derives current referral milestone and rejects client milestone identifiers`, `T-202a the second failed contact attempt does not raise LEVEL_2 and the third does`, and `T-202a failed counts are isolated when the case advances to a different milestone` cover server-derived milestone links and escalation counting.
- `T-202a failed contact sends unreachable_retry while REACHED does not`, `T-202a patient and doctor cannot write contact attempts`, `T-202a contact attempt write creates audit row and a readable attempt list`, and `T-202a receiving coordinator can contact only while a live consented referral exists` cover notification, RBAC, audit, listing, and receiving-provider scope.
- Not exercised: a browser UI workflow for these new actions, live external notification delivery, or a deployment with real providers/data. The notification remains an in-app outbox write.

## T-205a — Read-time attention engine

- `npm run lint` passed.
- Root `npm run build` passed for Next.js, server TypeScript, and shared TypeScript. Next.js printed its existing ESLint plugin configuration warning.
- `npm test`: 6 test files passed, 142 passed, 0 failed.
- `npm run test:db`: 69 top-level TAP tests across 4 suites; 158 tests, 158 passed, 0 failed. All 13 migrations were already applied to `careloop_test`.
- The 18 no-DB engine scenarios are named in `server/tests/attentionEngine.test.ts`; they cover each scoring rule, every state’s generic fallback mapping, urgency and overdue bonuses, the cap, the exact §5.4 scores `45/55/65/85`, score boundaries `29/30/59/60`, CLOSED behavior, rule stacking, sorting, and the operational reason-text denylist.
- `origin staff, consented receiving staff, and admin see only their permitted scopes`, `patient receives 403 for attention list and single-case attention`, and `single case outside provider visibility is concealed with 404` verify visibility and role behavior.
- `attention queue sorts by score and pages with an opaque cursor` verifies ordering and cursor paging. `new unassigned case scores thirty and urgent adds twenty` verifies the base urgent calculation.
- `advancing the injected clock forty eight hours moves an overdue urgent referral from MEDIUM to HIGH`, `acknowledging result_reviewed removes the unacknowledged reason`, and `rejected referral reason appears only after the reassignment window` exercise time and parallel facts through HTTP/database reads.
- `closed case is absent from the attention queue`, `attention reason text contains no clinical content`, and `snapshot query count stays constant for ten and fifty cases` verify filtering, copy safety, and batched loading. `attentionOnly case filter includes MEDIUM and HIGH cases using the engine` verifies the legacy case-list filter; `attention reads write audit records and patients cannot use attentionOnly as a level oracle` verifies audit coverage and the patient boundary.
- `staff case list and detail include attention summary while patient DTO omits it` verifies the DTO boundary.
- The T-202a gap tests are named `T-205a urgent referral rejection sets the four hour reassignment deadline`, `T-205a case referral history is scoped, cursor paged, and concealed from another provider`, and `T-205a referral appointment history is scoped, cursor paged, and concealed from another provider`.
- Not exercised: a browser dashboard consuming the new response, real provider data, and external notification delivery. Attention is operational only and has no clinical validation claim.

## T-205b — Escalation sweep, resolution, owner assignment, and demo clock

- `npm run lint` passes; root `npm run build` passes; `npm test` reports 7 files and 149/149 passed. The pure escalation tests cover due-time equality, one millisecond overdue, two and three full SLA periods, 48 hours exactly, 47 hours 59 minutes, and CLOSED.
- `npm run test:db`: 69 top-level TAP tests, 175 tests, 175 passed, 0 failed, after resetting the documented synthetic-only `careloop_test` database and applying all migrations. Named scenarios include `sweep raises level one for one millisecond overdue and a second sweep is a no-op`, `sweep raises level two and three at two and three completed SLA periods`, `level two escalates after exactly 48 uncleared hours and not before`, `sweep does not lower escalations and ignores closed and non-overdue cases`, `two concurrent sweeps emit only one escalation event`, and `sweep query count stays constant for ten and fifty open cases`.
- HTTP coverage includes resolve validation and the L1/L2/L3 role matrix, overdue delay-reason enforcement, due-date reset and later re-escalation, provider concealment, owner role/provider/queue rules, admin audit attribution, demo-clock caps/authorization/disabled routes, and `one 48 hour admin clock advance makes an urgent pending referral HIGH and escalated`. The transition suite separately verifies `third referral reassignment raises LEVEL_2 in the same transaction`; existing contact-attempt and consent suites verify their event-based escalation triggers.
- Live Compose curl returned 200 for doctor login, case creation (201), admin login, five-hour clock advance (three escalations raised), attention queue read, coordinator login, and resolution. The created synthetic case `CL-1008` appeared as HIGH / LEVEL_1 and resolved to LEVEL_0 with an `ESCALATION_CLEARED` event.
- Not exercised: production deployment and a browser UI for escalation/clock controls. Synthetic data only; operational thresholds remain illustrative and are not clinical standards.
