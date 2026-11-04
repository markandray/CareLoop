# API contract

Version 1 is a JSON REST API rooted at `/api/v1`. All timestamps are ISO-8601 UTC strings ending in `Z`; identifiers are UUIDs except human-readable case IDs (`CL-####`). Authentication uses a JWT in an `httpOnly`, `SameSite=Strict` cookie with `Secure` enabled in production; clients do not send bearer tokens. Bodies are JSON only. State-changing requests require a matching `Origin` check. Login is rate-limited. All endpoints except login require authentication; there is no public registration endpoint. Roles not listed for an action receive `403 FORBIDDEN`; resource visibility is additionally scoped as in Product Requirements §7. A missing resource returns `404 NOT_FOUND`.

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

| Method and path     | Roles                  | Request                           | Response                                  | Errors / event or audit                                                        |
| ------------------- | ---------------------- | --------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------ |
| `POST /auth/login`  | Public                 | `LoginRequest` (`email,password`) | `200 {user: UserSession}` and sets cookie | `UNAUTHENTICATED`, `VALIDATION_ERROR`, `RATE_LIMITED`; audit `LOGIN_SUCCEEDED` |
| `POST /auth/logout` | Any authenticated role | Empty                             | `204`, clears cookie                      | `UNAUTHENTICATED`; audit `LOGOUT`                                              |
| `GET /auth/me`      | Any authenticated role | None                              | `{user: UserSession}`                     | `UNAUTHENTICATED`; no case event                                               |

## Patients

| Method and path           | Roles                                                                  | Request                                                                                             | Response                                            | Errors / event or audit                                              |
| ------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------- |
| `POST /patients`          | DOCTOR, ADMIN                                                          | `CreatePatientRequest` (`email,name,syntheticMrn,dateOfBirth,preferredLanguage?,preferredChannel?`) | `{patient,user,temporaryPassword}` (generated once) | `VALIDATION_ERROR`, `CONFLICT`, `FORBIDDEN`; audit `PATIENT_CREATED` |
| `GET /patients/me`        | PATIENT                                                                | None                                                                                                | `PatientProfile`                                    | `NOT_FOUND`; audit sensitive read                                    |
| `PATCH /patients/me`      | PATIENT                                                                | `UpdatePatientProfileRequest`                                                                       | `PatientProfile`                                    | `VALIDATION_ERROR`; audit `PATIENT_PROFILE_UPDATED`                  |
| `GET /patients/:id`       | DOCTOR/COORDINATOR for own-provider or consented referral scope; ADMIN | None                                                                                                | `PatientProfile`                                    | `CONSENT_REQUIRED`, `NOT_FOUND`; audit sensitive read                |
| `GET /patients/:id/cases` | PATIENT (self), DOCTOR/COORDINATOR scoped, ADMIN                       | cursor query                                                                                        | role-specific case list                             | `FORBIDDEN`, `CONSENT_REQUIRED`; audit sensitive read                |

## Providers

| Method and path            | Roles                      | Request      | Response                                                                   | Errors / event or audit              |
| -------------------------- | -------------------------- | ------------ | -------------------------------------------------------------------------- | ------------------------------------ |
| `GET /providers`           | Any authenticated role     | cursor query | cursor page of `ProviderSummary` with `id`, `name`, and `type`             | `UNAUTHENTICATED`; audit read        |
| `GET /providers/:id/staff` | DOCTOR, COORDINATOR, ADMIN | cursor query | cursor page of `ProviderStaffDto` containing only `id`, `name`, and `role` | `NOT_FOUND`, `FORBIDDEN`; audit read |

## Cases

| Method and path                        | Roles                                                                          | Request                                                                        | Response                                                                                                                           | Errors / event or audit                                                                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /cases`                          | DOCTOR, ADMIN                                                                  | `CreateCaseRequest` (`transitionKey: CREATE_CASE`, evidence has intake fields) | `201 {case: CaseDetailDoctor\|CaseDetailAdmin,event: CaseEventDtoStaff}`                                                           | `VALIDATION_ERROR`, `EVIDENCE_MISSING`, `FORBIDDEN`; `CASE_CREATED`, audit creation                                                                                            |
| `GET /cases`                           | PATIENT (own), DOCTOR/COORDINATOR (own-provider plus permitted packets), ADMIN | `CaseListQuery` (including `updatedSince`)                                     | cursor page of scoped `CaseListItem`                                                                                               | `FORBIDDEN`, `CONSENT_REQUIRED`; audit sensitive reads                                                                                                                         |
| `GET /cases/:id`                       | PATIENT (own), DOCTOR/COORDINATOR scoped, ADMIN                                | None                                                                           | Exactly one `CaseDetailPatient`, `CaseDetailDoctor`, `CaseDetailCoordinator`, or `CaseDetailAdmin`, selected by authenticated role | `NOT_FOUND`, `FORBIDDEN`, `CONSENT_REQUIRED`; audit sensitive read                                                                                                             |
| `GET /cases/:id/events`                | Same as case detail                                                            | cursor query                                                                   | PATIENT gets cursor page of `CaseEventDtoPatient`; staff gets cursor page of `CaseEventDtoStaff`                                   | `NOT_FOUND`, `FORBIDDEN`, `CONSENT_REQUIRED`; audit sensitive read                                                                                                             |
| `GET /cases/:id/evidence`              | DOCTOR scoped, COORDINATOR (non-clinical kinds only), ADMIN                    | cursor query                                                                   | DOCTOR/ADMIN get cursor page of `EvidenceDto`; COORDINATOR gets cursor page of `CoordinatorEvidenceDto`                            | `NOT_FOUND`, `FORBIDDEN`; audit sensitive read                                                                                                                                 |
| `POST /cases/:id/confirmatory-results` | DOCTOR                                                                         | `ConfirmatoryResultRequest`                                                    | `EvidenceDto` and event                                                                                                            | `NOT_FOUND`, `FORBIDDEN`, `VALIDATION_ERROR`; `CONFIRMATORY_RESULT_RECORDED`, audit                                                                                            |
| `POST /cases/:id/decline-care`         | PATIENT (own)                                                                  | `DeclineCareRequest`                                                           | `{event: CaseEventDtoPatient}`                                                                                                     | `NOT_FOUND`, `FORBIDDEN`; `CARE_DECLINED_BY_PATIENT`, audit                                                                                                                    |
| `POST /cases/:id/transitions`          | Per Transition table below                                                     | `{transitionKey,expectedState,evidence,note?,delayReason?}`                    | `{case: role-specific CaseDetail,event: CaseEventDtoStaff}`                                                                        | `INVALID_TRANSITION`, `EVIDENCE_MISSING`, `FORBIDDEN`, `CONSENT_REQUIRED`, `DELAY_REASON_REQUIRED`, `NOT_FOUND`, `CONFLICT`; lifecycle event type from the selected row, audit |

`CaseDetailCoordinator` deliberately has no `resultCategory` or `resultSummaryApproved`; it may contain only an approved patient explanation. `GET /cases/:id/events` returns `CaseEventDtoPatient` to PATIENT (label, timestamp and patient-friendly status only) and `CaseEventDtoStaff` to staff. `ReferralPacket` is the receiving-provider projection and excludes origin-only notes and unrelated case details. Admin case access is read-only except the explicit owner assignment action.

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

| Method and path                         | Roles               | Request                                                                                                                        | Response                                               | Errors / event or audit                                                                                        |
| --------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `PUT /cases/:id/review-draft`           | DOCTOR              | `ReviewDraftRequest` (`resultSummary,recommendedNextStep,urgencyLabel,route`)                                                  | `ReviewDraftDto`                                       | `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`; stores fields while state remains NEW; audit `CASE_REVIEW_DRAFT_UPDATED` |
| `POST /cases/:id/explanations/generate` | DOCTOR              | `GenerateExplanationsRequest` (empty JSON object)                                                                              | `GenerateExplanationsResponse` with EN and AR drafts   | `NOT_FOUND`, `FORBIDDEN`, `EVIDENCE_MISSING`; `EXPLANATION_GENERATED`, audit                                   |
| `POST /cases/:id/closure-proposals`     | DOCTOR, COORDINATOR | `ClosureProposalRequest` (`closureReason,rationale,evidenceIds`)                                                               | `{event}`                                              | `NOT_FOUND`, `FORBIDDEN`, `EVIDENCE_MISSING`; `CLOSURE_PROPOSED`, audit                                        |
| `POST /cases/:id/understanding`         | PATIENT (own)       | `ConfirmUnderstandingRequest`                                                                                                  | `{case: CaseDetailPatient,event: CaseEventDtoPatient}` | `NOT_FOUND`, `FORBIDDEN`; `UNDERSTANDING_CONFIRMED`, audit                                                     |
| `POST /cases/:id/consent-requests`      | DOCTOR or COORDINATOR of origin provider | `ConsentRequestNotificationRequest` (`providerId`) | `NotificationDto` | `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`; queues and automatically sends `consent_needed`, `NOTIFICATION_SENT`, audit |
| `POST /cases/:id/contact-attempts`      | COORDINATOR         | `ContactAttemptRequest` (`milestoneState`, at most one referralId/appointmentId, channel, outcome, optional notes/delayReason) | `ContactAttemptDto` and event                          | `NOT_FOUND`, `FORBIDDEN`, `VALIDATION_ERROR`; `CONTACT_ATTEMPT_LOGGED`, audit                                  |

## Referrals

| Method and path              | Roles                                         | Request                   | Response                     | Errors / event or audit                                                                     |
| ---------------------------- | --------------------------------------------- | ------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------- |
| `GET /cases/:id/referrals`   | PATIENT own, DOCTOR/COORDINATOR scoped, ADMIN | cursor query              | cursor page of `ReferralDto` | `NOT_FOUND`, `FORBIDDEN`, `CONSENT_REQUIRED`; audit sensitive read                          |
| `GET /referrals/:id/packet`  | DOCTOR/COORDINATOR of receiving provider      | None                      | `ReferralPacket`             | `NOT_FOUND`, `FORBIDDEN`, `CONSENT_REQUIRED`; audit sensitive read                          |
| `POST /referrals/:id/reject` | DOCTOR/COORDINATOR of receiving provider      | `{rejectionReason,note?}` | `{referral,event}`           | `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`; sets REJECTED/respondedAt, `REFERRAL_REJECTED`, audit |

Accept and reassign use the lifecycle transition endpoint and `ACCEPT_REFERRAL` / `REASSIGN_REFERRAL` keys. All non-listed roles receive 403. Reassignment on an overdue case requires `delayReason`.

## Appointments

| Method and path                     | Roles                                         | Request                   | Response                        | Errors / event or audit                                                                     |
| ----------------------------------- | --------------------------------------------- | ------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------- |
| `GET /referrals/:id/appointments`   | PATIENT own, DOCTOR/COORDINATOR scoped, ADMIN | cursor query              | cursor page of `AppointmentDto` | `NOT_FOUND`, `FORBIDDEN`, `CONSENT_REQUIRED`; audit read                                    |
| `POST /appointments/:id/attendance` | COORDINATOR of receiving provider             | `RecordAttendanceRequest` | `AppointmentDto` and event      | `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`; `APPOINTMENT_ATTENDED` or `APPOINTMENT_MISSED`, audit |

## Follow-ups

| Method and path              | Roles                                         | Request                                                        | Response                     | Errors / event or audit                                                 |
| ---------------------------- | --------------------------------------------- | -------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------- |
| `POST /cases/:id/follow-ups` | DOCTOR of receiving provider                  | `CreateFollowUpRequest`                                        | `FollowUpDto`                | `NOT_FOUND`, `FORBIDDEN`, `VALIDATION_ERROR`; audit `FOLLOW_UP_CREATED` |
| `GET /cases/:id/follow-ups`  | PATIENT own, DOCTOR/COORDINATOR scoped, ADMIN | cursor query                                                   | cursor page of `FollowUpDto` | `NOT_FOUND`, `FORBIDDEN`, `CONSENT_REQUIRED`; audit read                |
| `PATCH /follow-ups/:id`      | DOCTOR of receiving provider                  | `UpdateFollowUpRequest` (`status: OPEN\|COMPLETED\|CANCELLED`) | `FollowUpDto`                | `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`; audit `FOLLOW_UP_UPDATED`         |

Scheduling and rescheduling are lifecycle transitions `SCHEDULE_APPOINTMENT` and `RESCHEDULE_APPOINTMENT`. Rescheduling always needs a delay reason; overdue corrections additionally require it at the request level and write the reason event payload.

## Contact attempts

`GET /cases/:id/contact-attempts` (PATIENT own, DOCTOR/COORDINATOR scoped, ADMIN; cursor page of `ContactAttemptDto`) lists attempts, each recording the exact `milestoneState` and optional `referralId` or `appointmentId`. `POST /cases/:id/contact-attempts` is described under Transitions and in-state actions. Failed-attempt rules count only attempts for the current open milestone. Both endpoints audit reads/writes; errors are `NOT_FOUND`, `FORBIDDEN`, `CONSENT_REQUIRED`, and `VALIDATION_ERROR` as applicable.

## Notifications

| Method and path                       | Roles                                           | Request                       | Response                                      | Errors / event or audit                                                                              |
| ------------------------------------- | ----------------------------------------------- | ----------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `GET /notifications`                  | PATIENT (own), DOCTOR/COORDINATOR scoped, ADMIN | cursor query                  | cursor page of `NotificationDto`              | `FORBIDDEN`; audit read                                                                              |
| `GET /notifications/:id`              | PATIENT (own), DOCTOR/COORDINATOR scoped, ADMIN | None                          | `NotificationDto`                             | `NOT_FOUND`; audit read                                                                              |
| `POST /notifications/:id/dispatch`    | COORDINATOR of the case origin provider        | `DispatchNotificationRequest` | `NotificationDto` and event                   | `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`, `EVIDENCE_MISSING` (422); requires an approved explanation; `NOTIFICATION_SENT`, audit |
| `POST /notifications/:id/acknowledge` | PATIENT (own)                                   | Empty                         | `{acknowledgedAt,event: CaseEventDtoPatient}` | `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`; `NOTIFICATION_ACKNOWLEDGED`, audit; sets case `acknowledgedAt` only for `result_reviewed` |

Dispatch is only manually available for queued `result_reviewed`; it requires an approved explanation for the case. All other configured notification templates are system-dispatched in the triggering transaction. Notification bodies contain no clinical detail and are localized from the catalog; Arabic DTOs carry `clinicallyReviewed: false`. Acknowledgement requires a sent notification and is recorded once per notification; every acknowledgement writes an event and audit row, but only `result_reviewed` acknowledgement sets the case-level `acknowledgedAt`. The response's `acknowledgedAt` is the time of that notification acknowledgement. The attention rule uses the case timestamp to measure acknowledgement of the initial `result_reviewed` notice. Understanding confirmation requires the case's approved explanation. These patient actions do not change workflow state. The 13 template keys are the Prisma `NotificationTemplateKey` enum.

## Consults

| Method and path             | Roles                               | Request                                               | Response                                    | Errors / event or audit                                                  |
| --------------------------- | ----------------------------------- | ----------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------ |
| `GET /cases/:id/consults`   | PATIENT own, DOCTOR scoped, ADMIN   | cursor query                                          | cursor page of `ConsultDto`                 | `NOT_FOUND`, `FORBIDDEN`; audit sensitive read                           |
| `POST /cases/:id/consults`  | PATIENT, DOCTOR                     | `CreateConsultRequest` (`kind,targetUserId,question`) | `ConsultDto` and role-appropriate event DTO | `NOT_FOUND`, `FORBIDDEN`, `VALIDATION_ERROR`; `CONSULT_REQUESTED`, audit |
| `POST /consults/:id/answer` | DOCTOR (target/authorized provider) | `{response}`                                          | `ConsultDto` and event                      | `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`; `CONSULT_ANSWERED`, audit          |

## Consent

| Method and path                         | Roles           | Request                                    | Response                               | Errors / event or audit                                                                     |
| --------------------------------------- | --------------- | ------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------- |
| `GET /patients/me/consents`             | PATIENT         | cursor query                               | cursor page of `ConsentDto`            | `FORBIDDEN`; audit `CONSENT_LIST_READ`                                                       |
| `POST /patients/me/consents`            | PATIENT         | `GrantConsentRequest` (`providerId,scope`) | `201 {consent: ConsentDto}`             | `NOT_FOUND`, `VALIDATION_ERROR`, `CONFLICT`; `CONSENT_GRANTED`, audit and open-case events  |
| `POST /patients/me/consents/:id/revoke` | PATIENT (owner) | Empty                                      | `{consent: ConsentDto}`                 | `NOT_FOUND`, `CONFLICT`; `CONSENT_REVOKED`, audit and open-case events; access severed now  |

Consent rows are immutable grants: revocation sets `revokedAt`, and a later grant creates a new row. A provider/scope pair may have only one active grant. Revocation also raises LEVEL_1 operational escalation on active referral, accepted-referral, or scheduled-appointment cases whose current referral targets that provider, unless a higher escalation is already present.

Receiving-provider case reads, referral packets, and lifecycle transitions all use the same current-referral plus active-consent check. Revocation removes those permissions immediately; a subsequent new grant restores them while that provider remains the current referral destination.

## Explanation

| Method and path                                       | Roles                                                                 | Request                     | Response                        | Errors / event or audit                                             |
| ----------------------------------------------------- | --------------------------------------------------------------------- | --------------------------- | ------------------------------- | ------------------------------------------------------------------- |
| `GET /cases/:id/explanations`                         | PATIENT own (approved only), DOCTOR scoped, COORDINATOR scoped, ADMIN | cursor query                | cursor page of `ExplanationDto` | `NOT_FOUND`, `FORBIDDEN`; audit sensitive read                      |
| `POST /cases/:id/explanations/:explanationId/approve` | DOCTOR                                                                | `ApproveExplanationRequest` | `ExplanationDto` and event      | `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`; `EXPLANATION_APPROVED`, audit |

The doctor first saves review fields while the case remains NEW, then requests deterministic template generation of EN and AR drafts. Both drafts must be approved before `REVIEW_CASE`; the transition carries only their approved IDs, and the server copies the saved draft fields into the case. No endpoint accepts raw clinical notes or asks an LLM directly. Patients only receive approved drafts. Arabic explanation limitations are shown with the DTO.

## Attention and escalation

| Method and path                      | Roles                            | Request                    | Response                                                                                                                        | Errors / event or audit                                                        |
| ------------------------------------ | -------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `GET /attention/cases`               | DOCTOR/COORDINATOR scoped, ADMIN | cursor query               | cursor page of `AttentionResponse`                                                                                              | `FORBIDDEN`; audit read                                                        |
| `GET /cases/:id/attention`           | DOCTOR/COORDINATOR scoped, ADMIN | None                       | `{attentionLevel,score,reasons[],suggestedAction,label:"Operational workflow rule, not a clinical risk assessment.",updatedAt}` | `NOT_FOUND`, `FORBIDDEN`; audit read                                           |
| `POST /cases/:id/escalation/resolve` | DOCTOR, COORDINATOR              | `ResolveEscalationRequest` | `{case,event}`                                                                                                                  | `NOT_FOUND`, `FORBIDDEN`, `DELAY_REASON_REQUIRED`; `ESCALATION_CLEARED`, audit |

Escalation creation is a system or authorized user rule action, not a direct client state mutation. The server computes overdue at query time. On corrective actions for overdue cases (including resolving escalation), the API requires the applicable `delayReason` and stores it in `DELAY_REASON_RECORDED` event payload. Admin may assign an owner but cannot resolve escalation.

## Analytics

| Method and path  | Roles | Request                                  | Response            | Errors / event or audit |
| ---------------- | ----- | ---------------------------------------- | ------------------- | ----------------------- |
| `GET /analytics` | ADMIN | `AnalyticsQuery` (`from?,to?,language?`) | `AnalyticsResponse` | `FORBIDDEN`; audit read |

Each metric carries `value`, `median`, `p90`, `cohortBasis`, `n`, and `suppressed`; duration metrics use median and P90. Rates and counts use the formula and denominator in Product Requirements §8.3. Language breakdowns are included. When `n < 10`, the value is suppressed (`suppressed: true`, `value: null`) to avoid small-group disclosure. `updatedAt` identifies the calculation snapshot.

## Simulation

| Method and path            | Roles | Request                        | Response                                                                                       | Errors / event or audit                                         |
| -------------------------- | ----- | ------------------------------ | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `POST /simulation/runs`    | ADMIN | `{seed,cohortSize:3000..5000}` | `SimulationRunResponse` with baseline/CareLoop metrics, language groups and assumptions notice | `FORBIDDEN`, `VALIDATION_ERROR`; audit `SIMULATION_RUN_CREATED` |
| `GET /simulation/runs/:id` | ADMIN | None                           | `SimulationRunResponse`                                                                        | `NOT_FOUND`, `FORBIDDEN`; audit read                            |

Simulation probabilities are documented assumptions and are not empirical outcome estimates.

## Demo controls

| Method and path            | Roles | Request                              | Response              | Errors / event or audit                                      |
| -------------------------- | ----- | ------------------------------------ | --------------------- | ------------------------------------------------------------ |
| `GET /demo/clock`          | ADMIN | None                                 | `DemoClockDto`        | `FORBIDDEN`; audit read                                      |
| `POST /demo/clock/advance` | ADMIN | `{amount,unit:MINUTES\|HOURS\|DAYS}` | `DemoClockDto`        | `FORBIDDEN`, `VALIDATION_ERROR`; audit `DEMO_CLOCK_ADVANCED` |
| `POST /demo/reset`         | ADMIN | `ResetDemoRequest`                   | `{resetAt,updatedAt}` | `FORBIDDEN`; audit `DEMO_DATA_RESET`                         |

## Admin

| Method and path            | Roles              | Request              | Response                     | Errors / event or audit                                        |
| -------------------------- | ------------------ | -------------------- | ---------------------------- | -------------------------------------------------------------- |
| `PUT /cases/:id/owner`     | COORDINATOR, ADMIN | `AssignOwnerRequest` | `{case,event}`               | `NOT_FOUND`, `FORBIDDEN`; `OWNER_ASSIGNED`, audit              |
| `GET /admin/config`        | ADMIN              | None                 | `{values,updatedAt}`         | `FORBIDDEN`; audit read                                        |
| `PATCH /admin/config/:key` | ADMIN              | `{value,reason}`     | `{key,value,updatedAt}`      | `FORBIDDEN`, `VALIDATION_ERROR`; audit `SYSTEM_CONFIG_UPDATED` |
| `GET /admin/audit-logs`    | ADMIN              | cursor query         | cursor page of `AuditLogDto` | `FORBIDDEN`; audit access                                      |

## Resolved decisions

- Referral creation happens inside `CREATE_REFERRAL_FROM_REVIEW` (COORDINATOR) or `CREATE_REFERRAL_AFTER_CONFIRMATION` (DOCTOR), matching each lifecycle row. No draft-referral endpoint exists. Reassignment creates a new row and supersedes the previous row.
- Both exits from `CLINICIAN_REVIEWED` require a `NOTIFICATION_SENT` event for `result_reviewed`; `CLOSE_AFTER_REVIEW_PATIENT_DECLINED` does not.
- All transition evidence omits server-owned IDs, actor/sign-off data, row IDs created by the transition, counts, and lookup facts. The server resolves those and validates the related rows/events. Each successful DOCTOR close generates sign-off evidence from the authenticated actor and server clock.
- `REVIEW_CASE` takes the two approved explanation IDs only; the server copies the saved doctor review draft. Case creation is the only transition without `expectedState`, because the case has no prior state.
- Patient accounts are created from seed data or by DOCTOR/ADMIN through `POST /patients`; there is no self-registration. The endpoint returns a generated temporary password once.
- Event reads are role-projected: patients receive only label, timestamp, and patient-friendly status; staff DTOs may include actor attribution and payload.
- Provider directory listing is available to any authenticated role; provider staff lookup is limited to DOCTOR, COORDINATOR, and ADMIN and returns only ID, name, and role.
- For append-only list items without a row-level `updatedAt`, list envelope `updatedAt` is the snapshot time.
- Session cookie uses `httpOnly`, `SameSite=Strict`, and `Secure` in production. Bodies are JSON only, state-changing calls verify `Origin`, and login is rate-limited.
- Login rate limiting enforces 5 failed attempts per 15 minutes per email+IP, returning HTTP 429 `RATE_LIMITED`. Successful logins do not count against the threshold. The prototype uses an in-memory tracker, which is acceptable for single-instance prototype scope and documented as a limitation.

## Spec issues

1. The product spec does not define a stable cursor encoding or whether clients may replay events. The API keeps cursors opaque and event replay internal.
2. The User schema has no deactivation flag (e.g. `isActive` or `deactivatedAt`). Active authentication relies on reloading the user record from PostgreSQL to immediately block deleted users, but explicit administrative deactivation is not represented in the schema without an additive migration.
