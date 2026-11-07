# API contract

Version 1 is a JSON REST API rooted at `/api/v1`. All timestamps are ISO-8601 UTC strings ending in `Z`; identifiers are UUIDs except human-readable case IDs (`CL-####`). Authentication uses a JWT in an `httpOnly`, `SameSite=Strict` cookie with `Secure` enabled in production; clients do not send bearer tokens. Bodies are JSON only. State-changing requests require a matching `Origin` check. Login is rate-limited. All endpoints except login require authentication; there is no public registration endpoint. Roles not listed for an action receive `403 FORBIDDEN`; resource visibility is additionally scoped as in Product Requirements §7. A missing resource returns `404 NOT_FOUND`.

Implementation status: the endpoint tables contain 54 operation rows: 39 are mounted and 15 are planned. Planned case and admin routes are tracked by T-506; follow-up routes by T-202; consult routes by T-204; analytics by T-403; simulation runs by T-404. Their task dependencies are T-202 on T-201, T-204 on T-104, T-403 on T-205, T-404 on T-403, and T-506 on T-105 and T-306. `/health` and non-production role-test routes are infrastructure/test routes and are listed in the task report.

Request and response names below correspond to exported Zod schemas/types from `@careloop/shared`. Unknown object keys are rejected. Lists use `?cursor=<opaque>&limit=25` (1–100), return `{items, nextCursor, updatedAt}`; `updatedAt` is the UTC snapshot time for the list. Individual mutable items include their `updatedAt`. Errors use `{error:{code,message,details?}}`, with codes `INVALID_TRANSITION`, `EVIDENCE_MISSING`, `FORBIDDEN`, `CONSENT_REQUIRED`, `NOT_FOUND`, `VALIDATION_ERROR`, `UNAUTHENTICATED`, `DELAY_REASON_REQUIRED`, `RATE_LIMITED`, `CONFLICT`, and `INTERNAL_ERROR`. Invalid bodies return `400 VALIDATION_ERROR`; unauthenticated requests return `401 UNAUTHENTICATED`; authorization failures return `403 FORBIDDEN`; stale expected state returns `409 CONFLICT`; rate-limited login returns `429 RATE_LIMITED`.

### Transition error mapping

| Error code | HTTP status | When returned |
| ---------- | ----------- | ------------- |
| `VALIDATION_ERROR` | 400 | The strict `TransitionRequestSchema` rejects a body, or transition evidence fails its selected schema. |
| `UNAUTHENTICATED` | 401 | The request has no valid session cookie. |
| `FORBIDDEN` | 403 | The authenticated role is not DOCTOR/COORDINATOR for this route, or state-machine role/provider authorization fails. PATIENT and ADMIN are denied before request validation. |
| `CONSENT_REQUIRED` | 403 | The state machine requires active cross-provider consent and none is active. |
| `NOT_FOUND` | 404 | The case is absent or outside the caller's visibility; the route does not reveal which condition applies. |
| `INVALID_TRANSITION` | 409 | The requested transition is not valid from the case's current state. |
| `CONFLICT` | 409 | `expectedState` is stale or a related row changed before the operation could complete. |
| `EVIDENCE_MISSING` | 422 | Request shape is valid but server-verified preconditions or evidence records are absent. |
| `DELAY_REASON_REQUIRED` | 422 | A corrective action requires a delay reason that was not supplied. |

## Auth

| Method and path     | Roles                  | Request                           | Response                                  | Errors / event or audit | Status |
| ------------------- | ---------------------- | --------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------ | ------ |
| `POST /auth/login`  | Public                 | `LoginRequest` (`email,password`) | `200 {user: UserSession}` and sets cookie | `UNAUTHENTICATED`, `VALIDATION_ERROR`, `RATE_LIMITED`; audit `LOGIN_SUCCEEDED` | `Implemented` |
| `POST /auth/logout` | Any authenticated role | Empty                             | `204`, clears cookie                      | `UNAUTHENTICATED`; audit `LOGOUT` | `Implemented` |
| `GET /auth/me`      | Any authenticated role | None                              | `{user: UserSession}`                     | `UNAUTHENTICATED`; no case event | `Implemented` |

## Patients

| Method and path           | Roles                                                                  | Request                                                                                             | Response                                            | Errors / event or audit | Status |
| ------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------- | ------ |
| `GET /patients?query=<text>&cursor=<opaque>&limit=20` | DOCTOR, ADMIN | `query` (case-insensitive display-name substring or synthetic MRN prefix; at least two characters), standard cursor and limit (maximum 20) | `{items: PatientSearchResult[], nextCursor, updatedAt}`; each result contains only `id,displayName,syntheticMrn,preferredLanguage` | `VALIDATION_ERROR`, `FORBIDDEN`; audit `PATIENT_SEARCH` | `Implemented` |

## Providers

| Method and path            | Roles                      | Request      | Response                                                                   | Errors / event or audit | Status |
| -------------------------- | -------------------------- | ------------ | -------------------------------------------------------------------------- | ------------------------------------ | ------ |
| `GET /providers`           | Any authenticated role     | cursor query | cursor page of `ProviderSummary` with `id`, `name`, and `type`             | `UNAUTHENTICATED`; audit read | `Implemented` |
| `GET /providers/:id/staff` | DOCTOR, COORDINATOR, ADMIN | cursor query | cursor page of `ProviderStaffDto` containing only `id`, `name`, and `role` | `NOT_FOUND`, `FORBIDDEN`; audit read | `Implemented` |

## Cases

| Method and path                        | Roles                                                                          | Request                                                                        | Response                                                                                                                           | Errors / event or audit | Status |
| -------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| `POST /cases`                          | DOCTOR, ADMIN                                                                  | `CreateCaseRequest` (`transitionKey: CREATE_CASE`, evidence has intake fields) | `201 {case: CaseDetailDoctor\|CaseDetailAdmin,event: CaseEventDtoStaff}`                                                           | `VALIDATION_ERROR`, `EVIDENCE_MISSING`, `FORBIDDEN`; `CASE_CREATED`, audit creation | `Implemented` |
| `GET /cases`                           | PATIENT (own), DOCTOR/COORDINATOR (own-provider plus permitted packets), ADMIN | `cursor?`, `limit?`, `state?`, `ownerUserId?`, `attentionOnly?`, `updatedSince?` | cursor page of scoped `CaseListItem`                                                                                               | `FORBIDDEN`, `CONSENT_REQUIRED`; audit sensitive reads | `Implemented` |
| `GET /cases/:id`                       | PATIENT (own), DOCTOR/COORDINATOR scoped, ADMIN                                | None                                                                           | Exactly one `CaseDetailPatient`, `CaseDetailDoctor`, `CaseDetailCoordinator`, or `CaseDetailAdmin`, selected by authenticated role | `NOT_FOUND`, `FORBIDDEN`, `CONSENT_REQUIRED`; audit sensitive read | `Implemented` |
| `GET /cases/:id/events`                | Same as case detail                                                            | cursor query                                                                   | PATIENT gets cursor page of `CaseEventDtoPatient`; staff gets cursor page of `CaseEventDtoStaff`                                   | `NOT_FOUND`, `FORBIDDEN`, `CONSENT_REQUIRED`; audit sensitive read | `Implemented` |
| `GET /cases/:id/evidence`              | DOCTOR scoped, COORDINATOR (non-clinical kinds only), ADMIN                    | cursor query                                                                   | DOCTOR/ADMIN get cursor page of `EvidenceDto`; COORDINATOR gets cursor page of `CoordinatorEvidenceDto`                            | `NOT_FOUND`, `FORBIDDEN`; audit sensitive read | `Planned (T-506)` |
| `POST /cases/:id/confirmatory-results` | DOCTOR                                                                         | `ConfirmatoryResultRequest`                                                    | `EvidenceDto` and event                                                                                                            | `NOT_FOUND`, `FORBIDDEN`, `VALIDATION_ERROR`; `CONFIRMATORY_RESULT_RECORDED`, audit | `Planned (T-506)` |
| `POST /cases/:id/decline-care`         | PATIENT (own)                                                                  | `DeclineCareRequest` (`reason`)                                                | `200 {event: CaseEventDtoPatient}`                                                                                                 | `NOT_FOUND`, `FORBIDDEN`, `CONFLICT` (closed case or repeat decline); `CARE_DECLINED_BY_PATIENT`, audit | `Implemented` |
| `POST /cases/:id/transitions`          | Per Transition table below                                                     | `{transitionKey,expectedState,evidence,note?,delayReason?}`                    | `{case: role-specific CaseDetail,event: CaseEventDtoStaff}`                                                                        | `INVALID_TRANSITION`, `EVIDENCE_MISSING`, `FORBIDDEN`, `CONSENT_REQUIRED`, `DELAY_REASON_REQUIRED`, `NOT_FOUND`, `CONFLICT`; lifecycle event type from the selected row, audit | `Implemented` |

`CaseDetailCoordinator` deliberately has no `resultCategory` or `resultSummaryApproved`; it may contain only an approved patient explanation. `GET /cases/:id/events` returns `CaseEventDtoPatient` to PATIENT (`id`, stable `labelKey`, timestamp, and current patient-facing status only) and `CaseEventDtoStaff` to staff. Patient event labels use the closed `PatientEventLabelKey` enum and are translated by the client. An explicit event-type allowlist is returned; all other event types, including escalation, owner, contact-attempt, rejected/reassigned referral, missed appointment, explanation processing, and closure proposal events, are omitted. Hidden events do not consume patient page slots or create empty pages. `ReferralPacket` is the receiving-provider projection and excludes origin-only notes and unrelated case details. Admin case access is read-only except the explicit owner assignment action.

Referral summaries and `ReferralDto` include nullable `reason`; appointment summaries and `AppointmentDto` include nullable `location`. Patient case details include the appointment location so the patient can find the scheduled visit.

### Lifecycle transition keys and evidence

Each lifecycle row in Product Requirements §1.1 maps to exactly one `TransitionKey`. `TransitionRequestSchema` requires `expectedState: CaseState`; a stale state is rejected with HTTP 409 `CONFLICT`. `CreateCaseRequestSchema` is the initial `none → NEW` bootstrap and therefore has no prior state. Evidence is a strict discriminated union. Clients send only human-entered content and choices; the server resolves associated records and validates preconditions. Missing records or facts return `422 EVIDENCE_MISSING` with `{required, observed}` details. In particular, unreachable closure checks for at least three failed attempts on the current milestone and an escalation event; `START_CARE` and completed-care closure require an ATTENDED appointment; patient-decline closures require the recorded decline; and confirmation/referral paths verify the recorded confirmatory result where applicable.

Every transition request includes `expectedState`; a mismatch returns `409 CONFLICT`. `CREATE_CASE` is the bootstrap `POST /cases` request and has no existing state to compare. For all `CLOSE_*` transitions the caller must be a DOCTOR. On successful close the server writes a `CLINICIAN_SIGN_OFF` Evidence row using the authenticated doctor and server clock; no sign-off fields are accepted from the client. A Doctor may include `closureProposalId` to reference a coordinator or doctor proposal. A Coordinator can only use `POST /cases/:id/closure-proposals`.

| TransitionKey                              | From → to                                     | Allowed roles                               | Required evidence fields                                                                                                                                                                 |
| ------------------------------------------ | --------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CREATE_CASE`                              | none → NEW                                    | DOCTOR, ADMIN                               | patientId, originProviderId, pathway, screeningType, resultCategory, preliminarySummary, recommendedAction, intakeUrgency; assignedDoctorId optional                                     |
| `REVIEW_CASE`                              | NEW → CLINICIAN_REVIEWED                      | DOCTOR                                      | approvedExplanationIds (the approved EN and AR draft IDs); saved review draft is copied by server                                                                                        |
| `REQUEST_CONFIRMATION`                     | CLINICIAN_REVIEWED → CONFIRMATION_PENDING     | COORDINATOR                                 | none; server requires `result_reviewed` NOTIFICATION_SENT event                                                                                                                          |
| `CREATE_REFERRAL_FROM_REVIEW`              | CLINICIAN_REVIEWED → REFERRAL_PENDING         | COORDINATOR                                 | toProviderId, referralReason; server requires `result_reviewed` NOTIFICATION_SENT event and active cross-provider consent when applicable                                                |
| `CLOSE_AFTER_REVIEW_PATIENT_DECLINED`      | CLINICIAN_REVIEWED → CLOSED                   | DOCTOR                                      | closureReason=PATIENT_DECLINED, documentedReason, closureProposalId optional                                                                                                             |
| `CREATE_REFERRAL_AFTER_CONFIRMATION`       | CONFIRMATION_PENDING → REFERRAL_PENDING       | DOCTOR                                      | toProviderId, referralReason; server verifies confirmatory result and consent where applicable                                                                                           |
| `CLOSE_NOT_CONFIRMED`                      | CONFIRMATION_PENDING → CLOSED                 | DOCTOR                                      | closureReason=NOT_CONFIRMED, documentedReason, closureProposalId optional; server verifies confirmatory result                                                                           |
| `CLOSE_CONFIRMATION_PATIENT_DECLINED`      | CONFIRMATION_PENDING → CLOSED                 | DOCTOR                                      | closureReason=PATIENT_DECLINED, documentedReason, closureProposalId optional; server verifies patient decline                                                                            |
| `CLOSE_CONFIRMATION_UNREACHABLE`           | CONFIRMATION_PENDING → CLOSED                 | DOCTOR                                      | closureReason=UNREACHABLE_AFTER_ATTEMPTS, documentedReason, closureProposalId optional; server verifies attempts and escalation                                                          |
| `ACCEPT_REFERRAL`                          | REFERRAL_PENDING → REFERRAL_ACCEPTED          | DOCTOR or COORDINATOR of receiving provider | referralId; authenticated actor/provider are server-derived                                                                                                                              |
| `REASSIGN_REFERRAL`                        | REFERRAL_PENDING → REFERRAL_PENDING           | COORDINATOR of sending provider             | toProviderId, referralReason, rejectionReason optional; server supersedes current referral and increments reassignment count                                                             |
| `CLOSE_REFERRAL_PATIENT_DECLINED`          | REFERRAL_PENDING → CLOSED                     | DOCTOR                                      | closureReason=PATIENT_DECLINED, documentedReason, closureProposalId optional; server verifies patient decline                                                                            |
| `CLOSE_REFERRAL_UNREACHABLE`               | REFERRAL_PENDING → CLOSED                     | DOCTOR                                      | closureReason=UNREACHABLE_AFTER_ATTEMPTS, documentedReason, closureProposalId optional; server verifies attempts and escalation                                                          |
| `CLOSE_REFERRAL_TRANSFERRED_OUT`           | REFERRAL_PENDING → CLOSED                     | DOCTOR                                      | closureReason=TRANSFERRED_OUT, documentedReason, externalProviderName, facilityContact, handoverSummary, closureProposalId optional                                                      |
| `SCHEDULE_APPOINTMENT`                     | REFERRAL_ACCEPTED → APPOINTMENT_SCHEDULED     | COORDINATOR of receiving provider           | scheduledAt, location; server creates appointment against accepted referral                                                                                                              |
| `CLOSE_ACCEPTED_REFERRAL_PATIENT_DECLINED` | REFERRAL_ACCEPTED → CLOSED                    | DOCTOR                                      | closureReason=PATIENT_DECLINED, documentedReason, closureProposalId optional; server verifies patient decline                                                                            |
| `CLOSE_ACCEPTED_REFERRAL_UNREACHABLE`      | REFERRAL_ACCEPTED → CLOSED                    | DOCTOR                                      | closureReason=UNREACHABLE_AFTER_ATTEMPTS, documentedReason, closureProposalId optional; server verifies attempts and escalation                                                          |
| `CLOSE_ACCEPTED_REFERRAL_TRANSFERRED_OUT`  | REFERRAL_ACCEPTED → CLOSED                    | DOCTOR                                      | closureReason=TRANSFERRED_OUT, documentedReason, externalProviderName, facilityContact, handoverSummary, closureProposalId optional                                                      |
| `START_CARE`                               | APPOINTMENT_SCHEDULED → CARE_STARTED          | DOCTOR of receiving provider                | carePlan, optional followUpAt (must be in the future and no more than 180 days ahead; defaults to now + 30 days); server verifies an appointment is ATTENDED                                                                                                                         |
| `RESCHEDULE_APPOINTMENT`                   | APPOINTMENT_SCHEDULED → APPOINTMENT_SCHEDULED | COORDINATOR of receiving provider           | scheduledAt, location; only a current `SCHEDULED` or `MISSED` appointment can be rescheduled; a `SCHEDULED` row becomes `RESCHEDULED`, a `MISSED` row stays `MISSED`, and the server creates a new `SCHEDULED` appointment; top-level delayReason always required |
| `CLOSE_SCHEDULED_PATIENT_DECLINED`         | APPOINTMENT_SCHEDULED → CLOSED                | DOCTOR                                      | closureReason=PATIENT_DECLINED, documentedReason, closureProposalId optional; server verifies patient decline                                                                            |
| `CLOSE_SCHEDULED_UNREACHABLE`              | APPOINTMENT_SCHEDULED → CLOSED                | DOCTOR                                      | closureReason=UNREACHABLE_AFTER_ATTEMPTS, documentedReason, closureProposalId optional; server verifies attempts and escalation                                                          |
| `CLOSE_SCHEDULED_TRANSFERRED_OUT`          | APPOINTMENT_SCHEDULED → CLOSED                | DOCTOR                                      | closureReason=TRANSFERRED_OUT, documentedReason, externalProviderName, facilityContact, handoverSummary, closureProposalId optional                                                      |
| `CLOSE_COMPLETED_CARE`                     | CARE_STARTED → CLOSED                         | DOCTOR of receiving provider                | closureReason=COMPLETED_CARE, documentedReason, careCompletionSummary, optional postTreatmentFindings/surveillancePlan, closureProposalId optional; server verifies ATTENDED appointment |
| `CLOSE_CARE_TRANSFERRED_OUT`               | CARE_STARTED → CLOSED                         | DOCTOR                                      | closureReason=TRANSFERRED_OUT, documentedReason, externalProviderName, facilityContact, handoverSummary, closureProposalId optional                                                      |

`CREATE_REFERRAL_*` creates its Referral row with status PENDING. `REASSIGN_REFERRAL` creates a new Referral and changes the previous row to SUPERSEDED. `SCHEDULE_APPOINTMENT` and `RESCHEDULE_APPOINTMENT` create Appointment rows; no client-supplied row IDs are accepted. For overdue corrective actions (reassignment, reschedule, escalation resolution), `delayReason` is required and stored in the `DELAY_REASON_RECORDED` event payload; rescheduling always requires it. The server compares dueAt with its clock.

## Transitions and in-state actions

| Method and path                         | Roles               | Request                                                                                                                        | Response                                               | Errors / event or audit | Status |
| --------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ------ |
| `PUT /cases/:id/review-draft`           | DOCTOR              | `ReviewDraftRequest` (`resultSummary,recommendedNextStep,urgencyLabel,route`)                                                  | `ReviewDraftDto`                                       | `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`; stores fields while state remains NEW; audit `CASE_REVIEW_DRAFT_UPDATED` | `Implemented` |
| `POST /cases/:id/explanations/generate` | DOCTOR              | empty JSON object                                                                              | `GenerateExplanationsResponse` with current EN and AR drafts   | `NOT_FOUND`, `FORBIDDEN`, `EVIDENCE_MISSING`; idempotent for unchanged hash; `EXPLANATION_GENERATED`, audit | `Implemented` |
| `POST /cases/:id/closure-proposals`     | DOCTOR, COORDINATOR | `ClosureProposalRequest` (`closureReason,rationale,evidenceIds`)                                                               | `{event}`                                              | `NOT_FOUND`, `FORBIDDEN`, `EVIDENCE_MISSING`; `CLOSURE_PROPOSED`, audit | `Planned (T-506)` |
| `POST /cases/:id/understanding`         | PATIENT (own)       | `ConfirmUnderstandingRequest`                                                                                                  | `{case: CaseDetailPatient,event: CaseEventDtoPatient}` | `NOT_FOUND`, `FORBIDDEN`; `UNDERSTANDING_CONFIRMED`, audit | `Implemented` |
| `POST /cases/:id/consent-requests`      | DOCTOR or COORDINATOR of origin provider | `ConsentRequestNotificationRequest` (`providerId`) | `201 NotificationDto` | `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`; queues and automatically sends `consent_needed`, `NOTIFICATION_SENT`, audit | `Implemented` |

## Referrals

| Method and path              | Roles                                         | Request                   | Response                     | Errors / event or audit | Status |
| ---------------------------- | --------------------------------------------- | ------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------- | ------ |
| `GET /cases/:id/referrals`   | PATIENT own, DOCTOR/COORDINATOR scoped, ADMIN | cursor query              | cursor page of `ReferralDto` | `NOT_FOUND`, `FORBIDDEN`, `CONSENT_REQUIRED`; audit sensitive read | `Implemented` |
| `GET /referrals/:id/packet`  | DOCTOR/COORDINATOR of receiving provider      | None                      | `ReferralPacket`             | `NOT_FOUND`, `FORBIDDEN`, `CONSENT_REQUIRED`; audit sensitive read | `Implemented` |
| `POST /referrals/:id/reject` | DOCTOR/COORDINATOR of receiving provider      | `{rejectionReason,note?}` | `{referral,event}`           | `NOT_FOUND`, `FORBIDDEN`, `CONSENT_REQUIRED`, `CONFLICT`; sets REJECTED/respondedAt, `REFERRAL_REJECTED`, audit; case remains REFERRAL_PENDING and returns to origin COORDINATOR queue with the configured rejected-referral window | `Implemented` |

Accept and reassign use the lifecycle transition endpoint and `ACCEPT_REFERRAL` / `REASSIGN_REFERRAL` keys. All non-listed roles receive 403. Reassignment on an overdue case requires `delayReason`.

## Appointments

| Method and path                     | Roles                                         | Request                   | Response                        | Errors / event or audit | Status |
| ----------------------------------- | --------------------------------------------- | ------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------- | ------ |
| `GET /referrals/:id/appointments`   | PATIENT own, DOCTOR/COORDINATOR scoped, ADMIN | cursor query              | cursor page of `AppointmentDto` | `NOT_FOUND`, `FORBIDDEN`, `CONSENT_REQUIRED`; audit read | `Implemented` |
| `POST /appointments/:id/attendance` | COORDINATOR of receiving provider             | `{status:"ATTENDED"}` or `{status:"MISSED",delayReason,note?}` | `{appointment,event}` | `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`, `DELAY_REASON_REQUIRED`; scheduled row only; case remains `APPOINTMENT_SCHEDULED`, dueAt becomes now + 24 h routine / 4 h urgent; `APPOINTMENT_ATTENDED` or `APPOINTMENT_MISSED`, plus `DELAY_REASON_RECORDED` for MISSED; audit | `Implemented` |

## Follow-ups

| Method and path              | Roles                                         | Request                                                        | Response                     | Errors / event or audit | Status |
| ---------------------------- | --------------------------------------------- | -------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------- | ------ |
| `POST /cases/:id/follow-ups` | DOCTOR of receiving provider                  | `CreateFollowUpRequest`                                        | `FollowUpDto`                | `NOT_FOUND`, `FORBIDDEN`, `VALIDATION_ERROR`; audit `FOLLOW_UP_CREATED` | `Planned (T-202)` |
| `GET /cases/:id/follow-ups`  | PATIENT own, DOCTOR/COORDINATOR scoped, ADMIN | cursor query                                                   | cursor page of `FollowUpDto` | `NOT_FOUND`, `FORBIDDEN`, `CONSENT_REQUIRED`; audit read | `Planned (T-202)` |
| `PATCH /follow-ups/:id`      | DOCTOR of receiving provider                  | `UpdateFollowUpRequest` (`status: OPEN\|COMPLETED\|CANCELLED`) | `FollowUpDto`                | `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`; audit `FOLLOW_UP_UPDATED` | `Planned (T-202)` |

Scheduling and rescheduling are lifecycle transitions `SCHEDULE_APPOINTMENT` and `RESCHEDULE_APPOINTMENT`. Rescheduling always needs a delay reason; overdue corrections additionally require it at the request level and write the reason event payload.

## Contact attempts

| Method and path | Roles | Request | Response | Errors / event or audit | Status |
| --- | --- | --- | --- | --- | --- |
| `GET /cases/:id/contact-attempts` | COORDINATOR at the origin provider, or at the receiving provider with a live referral and consent | cursor query | cursor page of `ContactAttemptDto` | `NOT_FOUND`, `FORBIDDEN`, `CONSENT_REQUIRED`; audit `CONTACT_ATTEMPT_LIST_READ` | `Implemented` |
| `POST /cases/:id/contact-attempts` | COORDINATOR at the origin provider, or at the receiving provider with a live referral and consent | `ContactAttemptRequest` (`channel`, `outcome`, optional notes/delayReason) | `201 {contactAttempt}` | `NOT_FOUND`, `FORBIDDEN`, `CONSENT_REQUIRED`, `VALIDATION_ERROR`; `CONTACT_ATTEMPT_LOGGED`, audit; FAILED/NO_ANSWER sends `unreachable_retry`, third failed attempt for the current milestone raises LEVEL_2 | `Implemented` |

`GET /cases/:id/contact-attempts` and `POST /cases/:id/contact-attempts` are restricted to a COORDINATOR at the origin provider or at the receiving provider while a live PENDING/ACCEPTED referral and active consent exist. The strict POST body accepts only `channel`, `outcome`, optional `notes`, and optional `delayReason`; client-supplied `milestoneState`, `referralId`, and `appointmentId` are rejected. The server derives the current case state and links either the latest non-superseded referral or the current scheduled/missed appointment (never both). Failed counts use the exact derived `(caseId, milestoneState, referralId, appointmentId)` tuple, so milestones are not combined. FAILED and NO_ANSWER queue and send `unreachable_retry`; the third failed outcome for one tuple raises LEVEL_2. Both endpoints audit writes/reads.

## Notifications

| Method and path                       | Roles                                           | Request                       | Response                                      | Errors / event or audit | Status |
| ------------------------------------- | ----------------------------------------------- | ----------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------ |
| `GET /notifications`                  | PATIENT (own), DOCTOR/COORDINATOR scoped, ADMIN | cursor query                  | cursor page of `NotificationDto`              | `FORBIDDEN`; audit read | `Implemented` |
| `GET /notifications/:id`              | PATIENT (own), DOCTOR/COORDINATOR scoped, ADMIN | None                          | `NotificationDto`                             | `NOT_FOUND`; audit read | `Implemented` |
| `POST /notifications/:id/dispatch`    | COORDINATOR of the case origin provider        | `DispatchNotificationRequest` | `NotificationDto` and event                   | `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`, `EVIDENCE_MISSING` (422); requires an approved explanation; `NOTIFICATION_SENT`, audit | `Implemented` |
| `POST /notifications/:id/acknowledge` | PATIENT (own)                                   | Empty                         | `{acknowledgedAt,event: CaseEventDtoPatient}` | `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`; `NOTIFICATION_ACKNOWLEDGED`, audit; sets notification `acknowledgedAt` once and case `acknowledgedAt` only for `result_reviewed` | `Implemented` |

Dispatch is only manually available for queued `result_reviewed`; it requires an approved explanation for the case. All other configured notification templates are system-dispatched in the triggering transaction. Notification bodies contain no clinical detail and are localized from the catalog. `NotificationDto.reviewNotice` is `UNREVIEWED_TRANSLATION` for Arabic and `NONE` for English and OTHER; no DTO claims clinical review. Each `NotificationDto` includes nullable `acknowledgedAt`; `null` means it has not been acknowledged. Acknowledgement requires a sent notification and is recorded once per notification; every acknowledgement writes an event and audit row and sets only that notification's `acknowledgedAt`. Only `result_reviewed` acknowledgement sets the separate case-level `acknowledgedAt`, which the attention rule uses for the initial notice. Understanding confirmation requires the case's approved explanation. These patient actions do not change workflow state. The 13 template keys are the Prisma `NotificationTemplateKey` enum.

## Consults

| Method and path             | Roles                               | Request                                               | Response                                    | Errors / event or audit | Status |
| --------------------------- | ----------------------------------- | ----------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------ | ------ |
| `GET /cases/:id/consults`   | PATIENT own, DOCTOR scoped, ADMIN   | cursor query                                          | cursor page of `ConsultDto`                 | `NOT_FOUND`, `FORBIDDEN`; audit sensitive read | `Planned (T-204)` |
| `POST /cases/:id/consults`  | PATIENT, DOCTOR                     | `CreateConsultRequest` (`kind,targetUserId,question`) | `ConsultDto` and role-appropriate event DTO | `NOT_FOUND`, `FORBIDDEN`, `VALIDATION_ERROR`; `CONSULT_REQUESTED`, audit | `Planned (T-204)` |
| `POST /consults/:id/answer` | DOCTOR (target/authorized provider) | `{response}`                                          | `ConsultDto` and event                      | `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`; `CONSULT_ANSWERED`, audit | `Planned (T-204)` |

## Consent

| Method and path                         | Roles           | Request                                    | Response                               | Errors / event or audit | Status |
| --------------------------------------- | --------------- | ------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------- | ------ |
| `GET /patients/me/consents`             | PATIENT         | cursor query                               | cursor page of `ConsentDto`            | `FORBIDDEN`; audit `CONSENT_LIST_READ` | `Implemented` |
| `POST /patients/me/consents`            | PATIENT         | `GrantConsentRequest` (`providerId,scope`) | `201 {consent: ConsentDto}`             | `NOT_FOUND`, `VALIDATION_ERROR`, `CONFLICT`; `CONSENT_GRANTED`, audit and open-case events | `Implemented` |
| `POST /patients/me/consents/:id/revoke` | PATIENT (owner) | Empty                                      | `{consent: ConsentDto}`                 | `NOT_FOUND`, `CONFLICT`; `CONSENT_REVOKED`, audit and open-case events; access severed now | `Implemented` |

Consent rows are immutable grants: revocation sets `revokedAt`, and a later grant creates a new row. A provider/scope pair may have only one active grant. Revocation also raises LEVEL_1 operational escalation on active referral, accepted-referral, or scheduled-appointment cases whose current referral targets that provider, unless a higher escalation is already present.

Receiving-provider case reads, referral packets, and lifecycle transitions all use the same current-referral plus active-consent check. Revocation removes those permissions immediately; a subsequent new grant restores them while that provider remains the current referral destination.

## Explanation

The shared explanation-core contract is `ReviewDraftFields` (`resultCategoryCode`, `nextStepCode`, `urgencyLabel`, `route`, optional `doctorNote`) and `ExplanationOutput` (`language`, sentence sections, `disclaimer`, `clinicallyReviewed`, optional `notTranslatedNote`, and `inputHash`). Stable codes are `ROUTINE_FINDING`, `FOLLOW_UP_NEEDED`, `UNCLEAR_RESULT`, `CONFIRMATION_NEEDED`, `REVIEW_NEEDED`; next-step codes are `CONFIRMATORY_TEST`, `SPECIALIST_REFERRAL`, `FOLLOW_UP_CLINICIAN`, `REPEAT_SCREENING`, `CARE_TEAM_CONTACT`, `NO_ACTION_NOW`. Draft code columns were added by migration `20261104020000_review_draft_catalog_codes`; `ExplanationDraft.inputHash` and `ScreeningCase.reviewDraftDoctorNote` by `20261104030000_explanation_input_hash`; and a non-unique history index by `20261104040000_explanation_history_index`.

`doctorNote` is confined to its dedicated output section and is included in the canonical input hash, but it does not change any patient explanation sentence. Arabic output has `clinicallyReviewed: false` and includes `notTranslatedNote`. Generation and validation are deterministic; see `docs/06-AI-Design.md`.

| Method and path                                       | Roles                                                                 | Request                     | Response                        | Errors / event or audit | Status |
| ----------------------------------------------------- | --------------------------------------------------------------------- | --------------------------- | ------------------------------- | ------------------------------------------------------------------- | ------ |
| `GET /cases/:id/explanations` | PATIENT own, DOCTOR origin provider, COORDINATOR scoped | None | `{items: ExplanationDto[]}`; patients/coordinators see only approved current rows; doctor sees all rows with `current`/`stale` labels | `NOT_FOUND`; sensitive read audit | `Implemented` |
| `POST /cases/:id/explanations/:explanationId/approve` | DOCTOR of origin provider | empty JSON object or `{note?}` | `200 {explanation}` with approval timestamp and reviewer | `NOT_FOUND`, `FORBIDDEN`, `CONFLICT` (stale or already approved); `EXPLANATION_APPROVED`, audit | `Implemented` |

The doctor first saves structured review fields while the case remains NEW, then requests deterministic template generation of EN and AR drafts. Both current-hash drafts must be approved before `REVIEW_CASE`; editing the draft while NEW makes earlier approvals stale. The transition carries the approved IDs and the server copies catalog-derived approved summary/next-step text, urgency and route. Explanation reads return a labelled `doctorNoteSection` separately from localized explanation text; Arabic carries `reviewNotice: UNREVIEWED_TRANSLATION`. No endpoint accepts raw clinical notes or asks an LLM directly. Patients only receive approved drafts. Arabic explanation limitations are shown with the DTO.

## Attention and escalation

| Method and path                      | Roles                            | Request                                                                       | Response                                                                                              | Errors / event or audit | Status |
| ------------------------------------ | -------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------ |
| `GET /attention/cases`               | DOCTOR/COORDINATOR scoped, ADMIN | `cursor?`, `limit?`, `minLevel?` (`LOW/MEDIUM/HIGH`), `minEscalation?` (`LEVEL_1..LEVEL_3`), `providerId?` (origin) | cursor page of `AttentionQueueItem` (caseId, state, dueAt, attentionLevel, score, escalationLevel, escalatedAt, reasons, suggestedAction, label) | `FORBIDDEN`, validation error; audit `ATTENTION_LIST_READ` | `Implemented` |
| `GET /cases/:id/attention`           | DOCTOR/COORDINATOR scoped, ADMIN | None                                                                          | `AttentionResponse` (`attentionLevel`, score, reason code/text/points, suggestedAction, label, overdueBy, slaPeriods) | `NOT_FOUND` for invisible/closed cases, `FORBIDDEN`; audit `ATTENTION_READ` | `Implemented` |
| `POST /cases/:id/escalation/resolve` | DOCTOR, COORDINATOR              | `{actionPlan:string(10..500),delayReason?:DelayReason}` | `{case,event}` | 409 `CONFLICT` if not escalated; `NOT_FOUND`, `FORBIDDEN`, 422 `DELAY_REASON_REQUIRED` when overdue; `ESCALATION_CLEARED`, optional `DELAY_REASON_RECORDED`, audit | `Implemented` |

The attention list is ordered by score descending, dueAt ascending (null last), then case ID ascending. Its opaque keyset cursor preserves that order. `minLevel` is inclusive; `providerId` filters by origin provider. Only open cases are returned. DOCTOR and COORDINATOR visibility includes origin-provider cases and cases with a current referral to their provider plus active consent; ADMIN sees all. Patients receive 403. The single-case route conceals closed and out-of-scope cases with 404. List and single reads are audited.

Staff case list and full detail DTOs also include `attention: { level, score }`, `escalationLevel`, and `escalatedAt` for DOCTOR, COORDINATOR and ADMIN. Patient DTOs and receiving-provider referral packets do not include the operational attention summary. The existing `attentionOnly=true` case-list filter now means `attention.level >= MEDIUM`, calculated by the same engine; it is available to staff roles only, and PATIENT receives 403. Attention is calculated on read and is never persisted. `minEscalation` is inclusive.

Every attention response uses the exact label `Operational workflow rule, not a clinical risk assessment.` Reasons are plain-language operational facts and contain no digits or denylisted clinical terms. `suggestedAction` is separate and uses the action associated with the highest-scoring reason; an urgent-timer-only result says `No action needed yet.` The score and reason vocabulary follows Product Requirements §5.2–5.4; the thresholds and weights are documented assumptions. A periodic locked sweep raises escalation when the shared `overdueInfo` calculation reaches the configured threshold. L1 starts after any overdue instant, L2 at two completed SLA periods, and L3 at three periods or after L2 remains uncleared for 48 hours. Event-based triggers (three failed contacts, three reassignments, and active-referral consent revocation) are raised inside their triggering transactions; the sweep does not reevaluate them. Escalations never auto-lower. Resolution is available to a scoped DOCTOR or COORDINATOR at L1 and a scoped DOCTOR at L2/L3; it requires a 10–500 character action plan, and overdue cases also require a delay reason. Resolution resets the case's current-state SLA window and clears `escalatedAt`. Admin may assign an owner but cannot resolve escalation.

| Rule code | `reasons[].text` | `suggestedAction` when this is the highest-scoring reason |
| --- | --- | --- |
| `UNASSIGNED` | This case has no owner assigned and has not been accepted into the workflow queue. | Assign a doctor or coordinator and set a due date. |
| `NOTIFICATION_UNACKNOWLEDGED` | The patient has not acknowledged the update within the configured time window. | Send a reminder and check that the patient can be reached. |
| `REFERRAL_PENDING` | This referral has been pending longer than the configured service time. | Follow up with the receiving provider or reassign the referral. |
| `REJECTED_REFERRAL_NOT_REASSIGNED` | A provider rejected this referral and it has not been reassigned. | Reassign the referral to another provider. |
| `APPOINTMENT_OVERDUE_OR_MISSED` | The appointment is overdue or was missed and no recovery step is recorded. | Record the outcome, reschedule, or escalate. |
| `FOLLOW_UP_DEADLINE_MISSED` | A required follow-up is past due and still open. | Reassign the follow-up or escalate. |
| `REPEATED_UNREACHABLE` | Repeated attempts to reach the patient have failed. | Escalate and document the contact attempts. |
| `UNANSWERED_CONSULT` | A consultation request has not been answered in time. | Ask a clinician to respond. |
| `GENERIC_STATE_SLA_BREACH` | This case is past its due date for its current step. | Complete or escalate the current step. |
| `URGENT_TIER` | This case is on the urgent timer. | No action needed yet when this is the only applicable rule. |

## Analytics

| Method and path  | Roles | Request                                  | Response            | Errors / event or audit | Status |
| ---------------- | ----- | ---------------------------------------- | ------------------- | ----------------------- | ------ |
| `GET /analytics` | ADMIN | `AnalyticsQuery` (`from?,to?,language?`) | `AnalyticsResponse` | `FORBIDDEN`; audit read | `Planned (T-403)` |

Each metric carries `value`, `median`, `p90`, `cohortBasis`, `n`, and `suppressed`; duration metrics use median and P90. Rates and counts use the formula and denominator in Product Requirements §8.3. Language breakdowns are included. When `n < 10`, the value is suppressed (`suppressed: true`, `value: null`) to avoid small-group disclosure. `updatedAt` identifies the calculation snapshot.

## Simulation

| Method and path            | Roles | Request                        | Response                                                                                       | Errors / event or audit | Status |
| -------------------------- | ----- | ------------------------------ | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------ |
| `POST /simulation/runs`    | ADMIN | `{seed,cohortSize:3000..5000}` | `SimulationRunResponse` with baseline/CareLoop metrics, language groups and assumptions notice | `FORBIDDEN`, `VALIDATION_ERROR`; audit `SIMULATION_RUN_CREATED` | `Planned (T-404)` |
| `GET /simulation/runs/:id` | ADMIN | None                           | `SimulationRunResponse`                                                                        | `NOT_FOUND`, `FORBIDDEN`; audit read | `Planned (T-404)` |

Simulation probabilities are documented assumptions and are not empirical outcome estimates.

## Demo controls

| Method and path            | Roles | Request                              | Response              | Errors / event or audit | Status |
| -------------------------- | ----- | ------------------------------------ | --------------------- | ------------------------------------------------------------ | ------ |
| `GET /demo/clock`          | Any authenticated role | None | `{now,offsetMs,isSimulated}` | audit `DEMO_CLOCK_READ`; 404 when disabled or in production | `Implemented` |
| `POST /demo/clock/advance` | ADMIN | `{amount>0,unit:MINUTES\|HOURS\|DAYS}`, at most 30 days per call | `{now,escalationsRaised}` | `FORBIDDEN`, `VALIDATION_ERROR`; sweep immediately follows; audit `DEMO_CLOCK_ADVANCED` | `Implemented` |
| `POST /demo/clock/reset`   | ADMIN | Empty | `{now}` | `FORBIDDEN`; resets simulated offset only; audit `DEMO_CLOCK_RESET`; 404 when disabled or in production | `Implemented` |

## Admin

| Method and path            | Roles              | Request              | Response                     | Errors / event or audit | Status |
| -------------------------- | ------------------ | -------------------- | ---------------------------- | -------------------------------------------------------------- | ------ |
| `PUT /cases/:id/owner`     | COORDINATOR of origin provider, or coordinator whose provider owns current queue; ADMIN | `{userId}` | `{case,event}` | `NOT_FOUND`, `FORBIDDEN`, `CONFLICT` for CLOSED, `VALIDATION_ERROR` for wrong provider/role; assigns state-expected role, clears queue columns, preserves `dueAt`; `OWNER_ASSIGNED`, audit | `Implemented` |
| `GET /admin/config`        | ADMIN              | None                 | `{values,updatedAt}`         | `FORBIDDEN`; audit read | `Planned (T-506)` |
| `PATCH /admin/config/:key` | ADMIN              | `{value,reason}`     | `{key,value,updatedAt}`      | `FORBIDDEN`, `VALIDATION_ERROR`; audit `SYSTEM_CONFIG_UPDATED` | `Planned (T-506)` |
| `GET /admin/audit-logs`    | ADMIN              | cursor query         | cursor page of `AuditLogDto` | `FORBIDDEN`; audit access | `Planned (T-506)` |

## Resolved decisions

- Referral creation happens inside `CREATE_REFERRAL_FROM_REVIEW` (COORDINATOR) or `CREATE_REFERRAL_AFTER_CONFIRMATION` (DOCTOR), matching each lifecycle row. No draft-referral endpoint exists. Reassignment creates a new row and supersedes the previous row.
- Both exits from `CLINICIAN_REVIEWED` require a `NOTIFICATION_SENT` event for `result_reviewed`; `CLOSE_AFTER_REVIEW_PATIENT_DECLINED` does not.
- All transition evidence omits server-owned IDs, actor/sign-off data, row IDs created by the transition, counts, and lookup facts. The server resolves those and validates the related rows/events. Each successful DOCTOR close generates sign-off evidence from the authenticated actor and server clock.
- `REVIEW_CASE` takes the two approved explanation IDs only; the server copies the saved doctor review draft. Case creation is the only transition without `expectedState`, because the case has no prior state.
- Patient accounts come from the synthetic screening feed; patient registration and patient creation are out of scope. There is no self-registration. DOCTOR and ADMIN may search the feed through `GET /patients`.
- Event reads are role-projected: patients receive only label, timestamp, and patient-friendly status; staff DTOs may include actor attribution and payload.
- Provider directory listing is available to any authenticated role; provider staff lookup is limited to DOCTOR, COORDINATOR, and ADMIN and returns only ID, name, and role.
- For append-only list items without a row-level `updatedAt`, list envelope `updatedAt` is the snapshot time.
- Session cookie uses `httpOnly`, `SameSite=Strict`, and `Secure` in production. Bodies are JSON only, state-changing calls verify `Origin`, and login is rate-limited.
- Login rate limiting enforces 5 failed attempts per 15 minutes per email+IP, returning HTTP 429 `RATE_LIMITED`. Successful logins do not count against the threshold. The prototype uses an in-memory tracker, which is acceptable for single-instance prototype scope and documented as a limitation.

`POST /cases/:id/decline-care` is the patient-owned route that records a `CARE_DECLINED_BY_PATIENT` event without changing workflow state. A clinician can then use the matching state-machine closure transition; the patient request alone never closes a case.

## Spec issues

1. The product spec does not define a stable cursor encoding or whether clients may replay events. The API keeps cursors opaque and event replay internal.
2. The User schema has no deactivation flag (e.g. `isActive` or `deactivatedAt`). Active authentication relies on reloading the user record from PostgreSQL to immediately block deleted users, but explicit administrative deactivation is not represented in the schema without an additive migration.
3. The spec does not define snapshot isolation for attention queue pages. Scores are recomputed on every request; if a case changes or the demo clock advances between pages, its score-based position can move across the opaque cursor. The cursor gives keyset ordering for each read, not a frozen multi-page snapshot.
