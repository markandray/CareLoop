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

- `every notification template is neutral in EN and AR with no clinical terms or digits` proves all 13 catalog entries pass the denylist and digit scan.
- `an automatic NOTIFICATION_SENT event does not satisfy result_reviewed dispatch evidence` proves the evaluator requires the exact review template key.
- `patient lists own localized notifications with catalog text` proves patient notification listing and localized DTO text.
- `coordinator notification list is limited to cases at their provider` proves staff notification scope.
- `admin can list notifications across providers` proves admin notification visibility.
- `origin coordinator dispatches result_reviewed and writes sent event, timestamp, and audit` proves dispatch authorization and atomic send records.
- `dispatch requires an approved explanation and returns 422 EVIDENCE_MISSING` proves the explanation prerequisite.
- `dispatching a notification twice returns 409 CONFLICT` proves duplicate dispatch rejection.
- `only the case origin coordinator may dispatch its result_reviewed notification` proves dispatch provider scoping.
- `patient acknowledgement sets acknowledgedAt once and preserves workflow state` proves acknowledgement timestamp and state invariance.
- `repeated patient acknowledgement returns 409 CONFLICT` proves duplicate acknowledgement rejection.
- `patient cannot see another patient notification in their notification list` proves patient list isolation.
- `patient cannot acknowledge another patient notification and receives 404` proves patient acknowledgement concealment.
- `approved understanding confirmation does not change workflow state` proves understanding confirmation state invariance.
- `understanding rejects an explanation belonging to a different case` proves explanation ownership validation.
- `consent request automatically sends consent_needed and records its event` proves the consent request notification path.
- `consent request from another provider cannot target an origin case` proves consent request provider authorization.

All database HTTP tests run with `node:test` against PostgreSQL through `npm run test:db`; they use synthetic fixtures. The API tests exercise the Express application in-process. No live external notification delivery is performed; `SENT` means the in-app outbox row was dispatched.
