# Product Requirements

CareLoop converts each actionable screening result into a single, auditable case with one owner, one next action, one due date, and one workflow state. The product is intentionally operational and accountability-focused: it prioritizes communication, case ownership, and escalation without allowing autonomous clinical decision-making.

This document is the product-level contract for the lifecycle, referral rules, permissions, attention engine, escalation policy, patient communications, and analytics defined in AGENTS.md sections 6 and 8. SLA values are illustrative configuration and not clinical standards.

---

## 1. Workflow contract

### 1.1 Lifecycle transition table (one row per transition)

A case begins at ingestion/creation (`none -> NEW`) and progresses through the lifecycle states. Each transition requires an explicit actor, meets strict preconditions, records required evidence, and assigns exactly one owner and one `dueAt` for the subsequent step.

| From state | To state | Actor role | Precondition | Evidence required | Owner and dueAt after transition | Notification template key | Event type |
|---|---|---|---|---|---|---|---|
| `none` | `NEW` | DOCTOR or ADMIN | Screening result data ingested from screening source or manually entered. | Intake screening payload (screening type, finding category, preliminary summary, recommended action, and `intakeUrgency`). | Owner is assigned DOCTOR (if assigned) or null (unassigned); `dueAt` = created + review SLA (`intakeUrgency`: 48h routine / 4h urgent). | None | `CASE_CREATED` |
| `NEW` | `CLINICIAN_REVIEWED` | DOCTOR | Case is assigned to a doctor and ready for clinical review. | Doctor approves result summary, recommended next step, confirms or updates `urgencyLabel`, selects route (confirmation or referral), and approves patient explanation (`ExplanationDraft` status APPROVED). | Owner becomes the originating provider's COORDINATOR queue; `dueAt` = now + 24h routine / 4h urgent (coordinator notification dispatch task). | `result_reviewed` (queued for manual dispatch) | `CASE_REVIEWED` |
| `CLINICIAN_REVIEWED` | `CONFIRMATION_PENDING` | COORDINATOR | Doctor selected confirmation route; notification `result_reviewed` dispatched. | Confirmation task created; patient notification dispatched; approved explanation attached. | Owner becomes DOCTOR; `dueAt` = now + 7d routine / 48h urgent. | `awaiting_confirmation` (auto-sent) | `CONFIRMATION_REQUESTED` |
| `CLINICIAN_REVIEWED` | `REFERRAL_PENDING` | COORDINATOR | Doctor selected referral route; active consent confirmed if cross-provider. | Referral record created; receiving provider designated; active consent present if cross-provider. | Owner becomes the receiving provider's COORDINATOR queue (sending coordinator retains reassign rights); `dueAt` = now + 3d routine / 24h urgent. | `referral_started` (auto-sent) | `REFERRAL_CREATED` |
| `CLINICIAN_REVIEWED` | `CLOSED` | DOCTOR | Patient declined further care after clinician review. | Patient decline record and documented refusal reason; signed off by DOCTOR. | Owner becomes null; `dueAt` = null. | `care_closed` (auto-sent) | `CASE_CLOSED` |
| `CONFIRMATION_PENDING` | `REFERRAL_PENDING` | DOCTOR | Confirmatory test complete; result indicates need for referral/treatment. | Confirmatory result record (`CONFIRMATORY_RESULT_RECORDED`); valid referral record created. | Owner becomes the receiving provider's COORDINATOR queue (sending coordinator retains reassign rights); `dueAt` = now + 3d routine / 24h urgent. | `referral_started` (auto-sent) | `REFERRAL_CREATED` |
| `CONFIRMATION_PENDING` | `CLOSED` | DOCTOR | Confirmatory test negative or inconclusive (closure reason: `NOT_CONFIRMED`). | Documented negative or normal confirmatory test result; signed off by DOCTOR. | Owner becomes null; `dueAt` = null. | `care_closed` (auto-sent) | `CASE_CLOSED` |
| `CONFIRMATION_PENDING` | `CLOSED` | DOCTOR | Patient declines confirmatory testing (closure reason: `PATIENT_DECLINED`). | Patient decline documentation and clinician sign-off. | Owner becomes null; `dueAt` = null. | `care_closed` (auto-sent) | `CASE_CLOSED` |
| `CONFIRMATION_PENDING` | `CLOSED` | DOCTOR | Patient unreachable after contact attempts threshold (closure reason: `UNREACHABLE_AFTER_ATTEMPTS`). | Logged contact attempts (>= 3), escalation record, and clinician sign-off. | Owner becomes null; `dueAt` = null. | `care_closed` (auto-sent) | `CASE_CLOSED` |
| `REFERRAL_PENDING` | `REFERRAL_ACCEPTED` | DOCTOR or COORDINATOR of the receiving provider | Active consent confirmed if cross-provider; referral details reviewed. | Referral acceptance record; receiving provider coordinator identity recorded. | Owner becomes the receiving provider's COORDINATOR queue; `dueAt` = now + 7d routine / 48h urgent (scheduling window). | `referral_accepted` (auto-sent) | `REFERRAL_ACCEPTED` |
| `REFERRAL_PENDING` | `REFERRAL_PENDING` (reassigned) | COORDINATOR (sending provider) | Prior referral rejected or cancelled; alternative receiving provider selected. | Referral rejection record (if applicable), new referral record, incremented reassignment count. | Owner becomes the new receiving provider's COORDINATOR queue (sending coordinator retains reassign rights); `dueAt` resets to now + 3d routine / 24h urgent. | `referral_reassigned` (auto-sent) | `REFERRAL_REASSIGNED` |
| `REFERRAL_PENDING` | `CLOSED` | DOCTOR | Patient declines referral or care (closure reason: `PATIENT_DECLINED`). | Patient decline record and documented reason; signed off by DOCTOR. | Owner becomes null; `dueAt` = null. | `care_closed` (auto-sent) | `CASE_CLOSED` |
| `REFERRAL_PENDING` | `CLOSED` | DOCTOR | Patient unreachable during referral placement (closure reason: `UNREACHABLE_AFTER_ATTEMPTS`). | Contact-attempt log (>= 3 failed), escalation record, and clinician sign-off. | Owner becomes null; `dueAt` = null. | `care_closed` (auto-sent) | `CASE_CLOSED` |
| `REFERRAL_PENDING` | `CLOSED` | DOCTOR | Patient transferred to provider outside CareLoop network (closure reason: `TRANSFERRED_OUT`). | External transfer documentation and destination details; signed off by DOCTOR. | Owner becomes null; `dueAt` = null. | `care_closed` (auto-sent) | `CASE_CLOSED` |
| `REFERRAL_ACCEPTED` | `APPOINTMENT_SCHEDULED` | COORDINATOR (receiving provider) | Referral accepted; clinical appointment slot identified. | Appointment date, time, location, and provider documented. | Owner becomes the receiving provider's COORDINATOR queue; `dueAt` = appointment time + 2d. | `appointment_scheduled` (auto-sent) | `APPOINTMENT_SCHEDULED` |
| `REFERRAL_ACCEPTED` | `CLOSED` | DOCTOR | Patient declines care before appointment is booked (closure reason: `PATIENT_DECLINED`). | Patient decline statement and documented reason; signed off by DOCTOR. | Owner becomes null; `dueAt` = null. | `care_closed` (auto-sent) | `CASE_CLOSED` |
| `REFERRAL_ACCEPTED` | `CLOSED` | DOCTOR | Patient unreachable while attempting to schedule (closure reason: `UNREACHABLE_AFTER_ATTEMPTS`). | Contact attempts log (>= 3 failed), escalation record, and clinician sign-off. | Owner becomes null; `dueAt` = null. | `care_closed` (auto-sent) | `CASE_CLOSED` |
| `REFERRAL_ACCEPTED` | `CLOSED` | DOCTOR | Care transferred to another provider outside network before booking (closure reason: `TRANSFERRED_OUT`). | Documented external transfer arrangement and clinician sign-off. | Owner becomes null; `dueAt` = null. | `care_closed` (auto-sent) | `CASE_CLOSED` |
| `APPOINTMENT_SCHEDULED` | `CARE_STARTED` | DOCTOR of the receiving provider | Patient attended appointment; clinical evaluation or treatment initiated. | Attended appointment evidence (`APPOINTMENT_ATTENDED` recorded by COORDINATOR) and documented treatment or surveillance plan. | Owner becomes DOCTOR of the receiving provider; `dueAt` = follow-up date (default: now + 30d). | `care_started` (auto-sent) | `CARE_STARTED` |
| `APPOINTMENT_SCHEDULED` | `APPOINTMENT_SCHEDULED` (rescheduled) | COORDINATOR (receiving provider) | Appointment missed or rescheduled prior to attendance. | Delay reason required (`APPOINTMENT_MISSED` or reschedule request), new appointment date/time recorded. | Owner remains the receiving provider's COORDINATOR queue; `dueAt` = new appointment time + 2d. | `appointment_rescheduled` (auto-sent) | `APPOINTMENT_RESCHEDULED` |
| `APPOINTMENT_SCHEDULED` | `CLOSED` | DOCTOR | Patient declines further appointments/care (closure reason: `PATIENT_DECLINED`). | Patient decline record and documented reason; signed off by DOCTOR. | Owner becomes null; `dueAt` = null. | `care_closed` (auto-sent) | `CASE_CLOSED` |
| `APPOINTMENT_SCHEDULED` | `CLOSED` | DOCTOR | Patient missed appointment and unreachable after outreach (closure reason: `UNREACHABLE_AFTER_ATTEMPTS`). | Missed appointment record, contact-attempt log (>= 3 failed), escalation record, clinician sign-off. | Owner becomes null; `dueAt` = null. | `care_closed` (auto-sent) | `CASE_CLOSED` |
| `APPOINTMENT_SCHEDULED` | `CLOSED` | DOCTOR | Patient transferred to outside provider prior to care start (closure reason: `TRANSFERRED_OUT`). | External transfer documentation and clinician sign-off. | Owner becomes null; `dueAt` = null. | `care_closed` (auto-sent) | `CASE_CLOSED` |
| `CARE_STARTED` | `CLOSED` | DOCTOR of the receiving provider | Completed treatment course or documented surveillance regimen (closure reason: `COMPLETED_CARE`). | Documented clinical care completion summary, post-treatment findings, or surveillance protocol signed off by DOCTOR. | Owner becomes null; `dueAt` = null. | `care_closed` (auto-sent) | `CASE_CLOSED` |
| `CARE_STARTED` | `CLOSED` | DOCTOR of the receiving provider | Patient care transferred to external provider during care phase (closure reason: `TRANSFERRED_OUT`). | Documented formal transfer-of-care summary and clinician sign-off. | Owner becomes null; `dueAt` = null. | `care_closed` (auto-sent) | `CASE_CLOSED` |

*Note on Case Assignment*: When a case is created in state `NEW` without an assigned doctor, or when an open case needs reassignment, the action **"Assign case owner"** may be performed by a COORDINATOR or ADMIN. This is an audited in-state action that sets `ownerUserId` and emits an `OWNER_ASSIGNED` event.

Both exits from `CLINICIAN_REVIEWED` (`CONFIRMATION_PENDING` and `REFERRAL_PENDING`) require a `NOTIFICATION_SENT` event for `result_reviewed`; closing from `CLINICIAN_REVIEWED` does not.

---

### 1.2 In-state events (non-transition)

These events do not change workflow state, but append to the immutable timeline and may trigger operational alerts or notifications:

- `CASE_CREATED`: Recorded at case initialization (`none -> NEW`).
- `OWNER_ASSIGNED`: Case owner set or reassigned by COORDINATOR or ADMIN.
- `NOTIFICATION_QUEUED`: Patient notification prepared and waiting in outbox.
- `NOTIFICATION_SENT`: Notification successfully dispatched to the patient.
- `NOTIFICATION_ACKNOWLEDGED`: Patient viewed the notification in the portal.
- `UNDERSTANDING_CONFIRMED`: Patient pressed "I understand" on the plain-language explanation.
- `CARE_DECLINED_BY_PATIENT`: Patient explicitly recorded refusal of care or referral.
- `EXPLANATION_GENERATED`: Draft explanation created from structured fields.
- `EXPLANATION_APPROVED`: DOCTOR approved the patient explanation draft.
- `CONFIRMATORY_RESULT_RECORDED`: Confirmatory lab or diagnostic result logged.
- `APPOINTMENT_ATTENDED`: COORDINATOR recorded patient attendance at scheduled appointment.
- `APPOINTMENT_MISSED`: COORDINATOR recorded patient missed scheduled appointment.
- `CONTACT_ATTEMPT_LOGGED`: COORDINATOR outreach attempt logged (phone, SMS, portal).
- `REFERRAL_REJECTED`: Receiving provider rejected referral with required rejection reason.
- `CONSULT_REQUESTED`: Patient-to-clinician or clinician-to-clinician consult submitted.
- `CONSULT_ANSWERED`: Clinician responded to consult question.
- `ESCALATION_RAISED`: System or user flagged case to an elevated escalation level.
- `ESCALATION_CLEARED`: Corrective action recorded and escalation resolved.
- `CONSENT_GRANTED`: Patient granted cross-provider data-sharing consent.
- `CONSENT_REVOKED`: Patient revoked cross-provider data-sharing consent.
- `DELAY_REASON_RECORDED`: Mandatory explanation captured for an overdue or rescheduled action.
- `CLOSURE_PROPOSED`: COORDINATOR documented rationale and evidence proposing case closure.

---

### 1.3 Closure matrix

Every closed case must terminate in state `CLOSED` with an authorized closure reason, mandatory evidence, and clinician sign-off. COORDINATOR may propose closure (`CLOSURE_PROPOSED`); DOCTOR may close directly in one step or sign off on a proposed closure (`CASE_CLOSED`).

| Closure reason | Allowed states | Required evidence | Sign-off role |
|---|---|---|---|
| `COMPLETED_CARE` | `CARE_STARTED` | Attended appointment evidence plus a documented treatment completion or ongoing surveillance regimen. | DOCTOR of the receiving provider |
| `NOT_CONFIRMED` | `CONFIRMATION_PENDING` | Documented negative or normal confirmatory diagnostic findings. | DOCTOR |
| `PATIENT_DECLINED` | `CLINICIAN_REVIEWED`, `CONFIRMATION_PENDING`, `REFERRAL_PENDING`, `REFERRAL_ACCEPTED`, `APPOINTMENT_SCHEDULED` | Patient decline record (`CARE_DECLINED_BY_PATIENT` or logged refusal) with documented clinical discussion notes. | DOCTOR |
| `UNREACHABLE_AFTER_ATTEMPTS` | `CONFIRMATION_PENDING`, `REFERRAL_PENDING`, `REFERRAL_ACCEPTED`, `APPOINTMENT_SCHEDULED` | Contact-attempt log showing at least 3 failed attempts across approved channels, escalation trail, and final unreachable status documentation. | DOCTOR |
| `TRANSFERRED_OUT` | `REFERRAL_PENDING`, `REFERRAL_ACCEPTED`, `APPOINTMENT_SCHEDULED`, `CARE_STARTED` | External provider transfer documentation, receiving facility contact, and summary handover record. | DOCTOR |

`CLOSED` is strictly terminal. No further state transitions are permitted once a case is closed.

---

### 1.4 Routine versus urgent SLA tiers

Urgency is managed through two explicit fields:
1. `intakeUrgency` (`ROUTINE` / `URGENT`): Assigned from the screening source finding upon ingestion. It governs the review SLA while the case is in state `NEW`.
2. `urgencyLabel` (`ROUTINE` / `URGENT`): Confirmed or modified by the DOCTOR during initial clinical review (`NEW -> CLINICIAN_REVIEWED`). Once set by the doctor, this confirmed urgency governs all subsequent SLA durations across the remainder of the case lifecycle.

| State or operational action | Routine SLA | Urgent SLA | SLA governor |
|---|---:|---:|---|
| Review after `NEW` | 48 h | 4 h | `intakeUrgency` |
| Coordinator notification dispatch (`result_reviewed`) | 24 h | 4 h | Doctor `urgencyLabel` |
| Patient acknowledgement window | 72 h | 24 h | Doctor `urgencyLabel` |
| Confirmatory result recording (`CONFIRMATION_PENDING`) | 7 d | 48 h | Doctor `urgencyLabel` |
| Referral acceptance after `REFERRAL_PENDING` | 3 d | 24 h | Doctor `urgencyLabel` |
| Rejected-referral reassign window | 24 h | 4 h | Doctor `urgencyLabel` |
| Appointment scheduling after `REFERRAL_ACCEPTED` | 7 d | 48 h | Doctor `urgencyLabel` |
| Consultation response | 24 h | 4 h | Doctor `urgencyLabel` |
| Default follow-up interval after `CARE_STARTED` | 30 d | 30 d | Clinician plan / default |

*Note*: SLAs are illustrative operational configurations, not clinical standards.

---

## 2. Referral and cross-provider rules

### 2.1 Receiving-provider user and queue ownership

A receiving-provider user is a DOCTOR or COORDINATOR affiliated with the provider organization designated on the referral record. 
- During `REFERRAL_PENDING`, ownership of the case belongs to the **receiving provider's coordinator queue**. The receiving provider is responsible for accepting or rejecting the referral within SLA.
- The **sending provider's coordinator retains explicit reassign rights** via the referral record. If the receiving provider rejects the referral, or if acceptance breaches SLA, the sending coordinator reassigns the case to an alternative provider or escalates.

### 2.2 Cross-provider consent rules and revocation

1. **Same-provider referrals**: If the receiving provider is the same entity as the originating provider, no additional consent record is required.
2. **Cross-provider referrals**: When the receiving provider differs from the originating provider:
   - An active consent record (`CONSENT_GRANTED`) for the patient and referral scope must exist before the referral packet can be created or viewed by the receiving provider.
   - If consent is missing, the system queues a `consent_needed` notification to the patient.
3. **Consent revocation during an active referral**: If the patient revokes consent (`CONSENT_REVOKED`) while a case is in `REFERRAL_PENDING`, `REFERRAL_ACCEPTED`, or `APPOINTMENT_SCHEDULED` prior to care initiation:
   - The receiving provider's access to the patient record and referral packet is immediately severed.
   - The case raises an automatic **LEVEL_1 escalation** routed to the sending coordinator.
   - Progress is halted until the patient re-grants consent or the case is redirected/closed.

### 2.3 Reassignment policy

When a referral is rejected or cannot be fulfilled:
1. Reassignment does not overwrite the existing referral row; it appends a new referral row with a new `referralId`.
2. The case remains in state `REFERRAL_PENDING`.
3. The sending coordinator must reassign the referral within the configured reassign window (24h routine / 4h urgent).
4. `dueAt` resets to `now + referral acceptance SLA` (3d routine / 24h urgent) assigned to the new receiving provider's coordinator queue.
5. The case reassignment counter increments. If reassignment count reaches 3, the case escalates to LEVEL_2.

---

## 3. Patient communications and status tracking

### 3.1 Notification dispatch model

CareLoop separates high-stakes clinical disclosure from routine operational updates:
- **Manual dispatch (`result_reviewed`)**: When the DOCTOR reviews the case and approves the explanation, the `result_reviewed` notification is placed in the outbox (`NOTIFICATION_QUEUED`). The COORDINATOR manually dispatches this initial notification to ensure appropriate timing and channel delivery. Dispatch requires an approved explanation.
- **Automated dispatch (all other templates)**: All subsequent notifications are auto-sent by the platform immediately upon their triggering state change or event.
- **Content privacy**: All notifications contain strictly non-clinical operational phrasing (e.g., "Your doctor has shared an update regarding your recent screening"). Notifications never contain diagnoses, lab values, or drug names.

Notification template keys:
- `result_reviewed` (manual coordinator dispatch)
- `consent_needed` (auto-sent on cross-provider referral without consent)
- `awaiting_confirmation` (auto-sent on `CONFIRMATION_PENDING`)
- `referral_started` (auto-sent on `REFERRAL_PENDING`)
- `referral_accepted` (auto-sent on `REFERRAL_ACCEPTED`)
- `referral_reassigned` (auto-sent on referral reassignment)
- `appointment_scheduled` (auto-sent on `APPOINTMENT_SCHEDULED`)
- `appointment_rescheduled` (auto-sent on reschedule)
- `care_started` (auto-sent on `CARE_STARTED`)
- `care_closed` (auto-sent on `CASE_CLOSED`)
- `followup_due` (auto-sent when follow-up due date approaches)
- `unreachable_retry` (auto-sent after failed outreach attempt)
- `consult_pending` (auto-sent when consult is requested)

### 3.2 Patient portal status mapping and acknowledgement

| Workflow state | Patient-facing display label | Description shown to patient |
|---|---|---|
| `NEW` | Under clinical review | "Your screening result has been received and is being reviewed by a clinician." |
| `CLINICIAN_REVIEWED` | Next step planned | "Your doctor has reviewed your result and recommended a follow-up plan." |
| `CONFIRMATION_PENDING` | Waiting for confirmation | "Additional confirmatory testing has been requested to clarify your findings." |
| `REFERRAL_PENDING` | Referral in progress | "A referral to a specialist clinic is being arranged." |
| `REFERRAL_ACCEPTED` | Referral accepted | "The specialist clinic has accepted your referral and will book your visit." |
| `APPOINTMENT_SCHEDULED` | Appointment scheduled | "Your follow-up appointment has been booked. Details and location are listed below." |
| `APPOINTMENT_SCHEDULED` (rescheduled) | Appointment rescheduled | "Your appointment time has been updated." |
| `CARE_STARTED` | Care started | "You have attended your appointment and your clinical care plan is underway." |
| `CLOSED` + `COMPLETED_CARE` | Care completed | "Your recommended care pathway has been completed." |
| `CLOSED` + `PATIENT_DECLINED` | Care declined | "You have indicated that you do not wish to proceed with further follow-up at this time." |
| `CLOSED` + `NOT_CONFIRMED` | Follow-up not required | "Confirmatory tests showed that further follow-up is not required." |
| `CLOSED` + `UNREACHABLE_AFTER_ATTEMPTS` | Coordination paused | "Our team was unable to reach you after multiple attempts. Please contact your clinic." |
| `CLOSED` + `TRANSFERRED_OUT` | Transferred to external care | "Your care has been transferred to an external medical provider outside CareLoop." |

**Patient Actions in Portal**:
1. **Acknowledge Notification**: Records `acknowledgedAt` timestamp (`NOTIFICATION_ACKNOWLEDGED`).
2. **Confirm Understanding**: After reading the approved plain-language explanation, the patient may click "I understand" (`UNDERSTANDING_CONFIRMED`).
3. **Decline Care**: Patient can indicate they choose not to proceed (`CARE_DECLINED_BY_PATIENT`), notifying the coordinator to follow up.
4. **Grant / Revoke Consent**: Patient manages cross-provider data-sharing authorization.
5. **Request Consult**: Patient can submit an operational or non-urgent clarification question.

---

## 4. Explanation generation and urgency governance

### 4.1 Explanation approval flow

Patient explanations translate clinical findings into comprehensible, culturally sensitive language without introducing novel diagnostic claims.

1. **Input constraint**: Explanations are generated **only** from doctor-approved structured fields (screening type, finding category, approved summary, recommended next step, and `urgencyLabel`). Raw EHR notes or unverified text are never ingested.
2. **Generation**: The explanation engine generates a localized draft in English and Arabic (`EXPLANATION_GENERATED`).
3. **Draft review**: Saved as `ExplanationDraft` with status `DRAFT`.
4. **Doctor approval mandatory**: The DOCTOR must review and approve the draft (`EXPLANATION_APPROVED`) as a mandatory precondition to leaving state `NEW`.
5. **Patient visibility**: PATIENT can view the explanation only after status is `APPROVED`.
6. **Safety fallback**: If LLM rewrites fail structural or clinical guardrail validation, deterministic localized templates are applied automatically.

### 4.2 Urgency labels

- Allowed values: `ROUTINE`, `URGENT`.
- Distinction:
  - `intakeUrgency` is set at ingestion based on screening source rules and dictates initial review SLA.
  - `urgencyLabel` is clinician-confirmed at review and governs all subsequent operational SLAs.
- **Safety notice**: Urgency labels are strictly operational workflow timers, not medical risk grades or diagnostic severity markers.

---

## 5. Attention engine, scoring, and escalation

### 5.1 Operational definition of unassigned

A case is **unassigned** if it is in an active, non-terminal workflow state (`state != CLOSED`) and has no individual owner and no queue owner (`ownerUserId = null` and `ownerRole = null`).

### 5.2 Attention scoring model

Attention indicates operational drop-off risk, not clinical severity. Every attention output is stamped with: *"Operational workflow rule, not a clinical risk assessment."*

| Attention rule | Base points | Trigger condition |
|---|---:|---|
| Unassigned case | 30 | Case is non-terminal with `ownerUserId = null` and `ownerRole = null`. |
| Notification unacknowledged after window | 20 | `acknowledgedAt` is null and elapsed time since dispatch exceeds window (72h routine / 24h urgent). |
| Referral pending longer than SLA | 25 | In `REFERRAL_PENDING` and elapsed time exceeds referral acceptance SLA (3d routine / 24h urgent). |
| Rejected referral not reassigned | 25 | Referral rejected by receiving provider and reassign window breached (24h routine / 4h urgent). |
| Appointment overdue or missed | 25 | Appointment time passed without attendance logged, or appointment marked `MISSED`. |
| Follow-up deadline missed | 20 | In `CARE_STARTED` and scheduled follow-up `dueAt` has elapsed without action. |
| Repeated unreachable patient | 30 | Failed contact attempts >= 3 recorded for the current open milestone. |
| Unanswered consult after SLA | 15 | Open consult request exceeds response SLA (24h routine / 4h urgent). |
| Generic state-SLA breach | 20 | Fallback rule for states with no specific rule: `now > dueAt`. |
| **Overdue multiplier bonus** | +10 per period | `+10 * floor(overdue / SLA duration)`, capped at **+40**. |
| **Urgent tier bonus** | +20 | Case `urgencyLabel` (or `intakeUrgency` in `NEW`) is set to `URGENT`. |

**Attention Levels**:
- **LOW**: Total score < 30
- **MEDIUM**: Total score 30 – 59
- **HIGH**: Total score >= 60

### 5.3 State to attention rule mapping

The generic state-SLA breach rule (+20) acts strictly as a fallback. It fires only when a state has breached `dueAt` and does not have a dedicated specific rule for that milestone:

| Workflow state | Specific rule(s) applicable | Falls back to generic rule? | Mapping description |
|---|---|---|---|
| `NEW` | Unassigned case (if unowned) | **Yes** | Breaching the initial review SLA falls back to the Generic State-SLA Breach rule. |
| `CLINICIAN_REVIEWED` | None | **Yes** | Breaching the coordinator notification dispatch SLA (24h / 4h) falls back to the Generic State-SLA Breach rule. |
| `CONFIRMATION_PENDING` | Repeated unreachable patient | **Yes** | Breaching the confirmatory test SLA (7d / 48h) falls back to the Generic State-SLA Breach rule. |
| `REFERRAL_PENDING` | Referral pending longer than SLA (+25); Rejected referral not reassigned (+25) | **No** | Governed exclusively by specific referral rules. Never fires generic rule. |
| `REFERRAL_ACCEPTED` | Repeated unreachable patient | **Yes** | Breaching the appointment scheduling SLA (7d / 48h) falls back to the Generic State-SLA Breach rule. |
| `APPOINTMENT_SCHEDULED` | Appointment overdue or missed (+25); Repeated unreachable patient | **No** | Governed exclusively by the specific appointment rule. Never fires generic rule. |
| `CARE_STARTED` | Follow-up deadline missed (+20) | **No** | Governed exclusively by the specific follow-up deadline rule. |
| `CLOSED` | None | **No** | Terminal state; excluded from the attention engine. |

*Parallel rules*: "Notification unacknowledged after window", "Unanswered consult after SLA", and "Repeated unreachable patient" evaluate across active states alongside primary state rules.

### 5.4 Worked scoring example

Scenario: A case in `REFERRAL_PENDING` with `urgencyLabel = URGENT` (SLA duration = 24h). The receiving provider has not responded.

1. **At SLA breach (overdue = 1h)**:
   - Base referral pending rule: +25
   - Urgent tier bonus: +20
   - Overdue bonus: `+10 * floor(1 / 24) = 0`
   - **Total score = 45 => MEDIUM**
2. **At 1 full period overdue (overdue = 24h)**:
   - Base referral pending rule: +25
   - Urgent tier bonus: +20
   - Overdue bonus: `+10 * floor(24 / 24) = +10`
   - **Total score = 55 => MEDIUM**
3. **At 2 full periods overdue (overdue = 48h)**:
   - Base referral pending rule: +25
   - Urgent tier bonus: +20
   - Overdue bonus: `+10 * floor(48 / 24) = +20`
   - **Total score = 65 => HIGH** (also crosses LEVEL_2 escalation threshold)
4. **At 4+ full periods overdue (overdue >= 96h)**:
   - Base referral pending rule: +25
   - Urgent tier bonus: +20
   - Overdue bonus: `+10 * floor(96 / 24) = +40` (cap reached)
   - **Total score = 85 => HIGH**

---

### 5.5 Escalation policy

Escalation is an **operational overlay** on top of the case; it flags the case in high-priority queues without altering its underlying workflow state.

| Escalation level | Deterministic trigger condition | Routed recipient queue | How cleared |
|---|---|---|---|
| `LEVEL_0` | Default state; all operational SLAs met. | None | N/A |
| `LEVEL_1` | Any operational SLA breach (`overdue > 0`) **OR** patient revokes consent during an active referral. | COORDINATOR queue | Corrective action logged (reassignment, reschedule, outreach) and `dueAt` reset, or case resolved. |
| `LEVEL_2` | Overdue >= 2 full SLA periods (`floor(overdue / SLA) >= 2`) **OR** 3 failed contact attempts **OR** 3 referral reassignments. | DOCTOR queue and COORDINATOR queue | Explicit clinician and coordinator review record and documented action plan. |
| `LEVEL_3` | Overdue >= 3 full SLA periods (`floor(overdue / SLA) >= 3`) **OR** LEVEL_2 escalation remaining uncleared for >= 48 hours. | DOCTOR queue (including the originating doctor) plus an ADMIN notification | Clinician sign-off, direct clinical intervention, formal case reassignment, or audited closure. |

**Strict Admin Escalation Constraint**:
An ADMIN **cannot resolve escalations**. Escalation resolution requires clinical or coordinator operational ownership. An ADMIN may **only assign a case owner to a stuck or unassigned case** (`ownerUserId` assignment), and this action is strictly logged in the immutable audit trail.

---

## 6. Role and permission model

### 6.1 Role definitions

- **PATIENT**: Authenticated individual viewing their personal screening journey. Sees only their own records; confirms understanding; grants/revokes consent; may decline care or submit consult queries.
- **DOCTOR**: Licensed clinical provider. Confirms urgency; approves result explanations; orders confirmations; creates and reviews referrals; signs off closures (or closes directly in one step); answers consults; receives LEVEL_2 and LEVEL_3 cases in the DOCTOR queue, with LEVEL_3 also routed to the originating doctor.
- **COORDINATOR**: Healthcare operations coordinator. Manages patient queues; dispatches queued notifications; handles referral routing and reassignments; books appointments; logs attendance/misses and contact attempts; proposes closures; receives LEVEL_1 cases and shares the LEVEL_2 queue with DOCTORs.
- **ADMIN**: System administrator. System configuration, demo clock management, seed data, and operational KPI oversight. Read-only on clinical content. May assign case owners to unassigned cases (audited); cannot execute clinical actions or resolve escalations. Receives an ADMIN notification for LEVEL_3 escalation.

### 6.2 Action x role permission matrix

| Action | PATIENT | DOCTOR | COORDINATOR | ADMIN |
|---|---|---|---|---|
| Create case (`none -> NEW`) | No | Yes | No | Yes (audited) |
| Assign case owner (`OWNER_ASSIGNED`) | No | No | Yes | Yes (audited) |
| View case details | Own case only | Own-provider cases and consented referral packets | Own-provider cases and consented referral packets | Full visibility, read-only |
| Set / confirm `urgencyLabel` | No | Yes | No | No |
| Approve explanation (`EXPLANATION_APPROVED`) | No | Yes | No | No |
| Dispatch notification (`result_reviewed`) | No | No | Yes | No |
| Confirm understanding (`UNDERSTANDING_CONFIRMED`) | Yes | No | No | No |
| Record confirmatory result | No | Yes | No | No |
| Create referral | No | Yes | Yes | No |
| Accept referral | No | Yes, if DOCTOR of the receiving provider | Yes, if COORDINATOR of the receiving provider | No |
| Reject referral | No | Yes, if DOCTOR of the receiving provider | Yes, if COORDINATOR of the receiving provider | No |
| Reassign referral | No | No | Yes (sending coordinator) | No |
| Schedule appointment | No | No | Yes (receiving coordinator) | No |
| Record appointment attendance (`ATTENDED` / `MISSED`) | No | No | Yes (receiving coordinator) | No |
| Record care started (`CARE_STARTED`) | No | Yes, if DOCTOR of the receiving provider | No | No |
| Log contact attempt | No | No | Yes | No |
| Propose closure (`CLOSURE_PROPOSED`) | No | Yes | Yes | No |
| Sign off closure / Close directly (`CASE_CLOSED`) | No | Yes (can propose & sign off in 1 step) | No (propose only) | No |
| Resolve escalation | No | Yes | Yes | No (assign owner only) |
| Grant or revoke consent | Yes | No | No | No |
| Decline care | Yes | No | No | No |
| Request consult | Yes | Yes | No | No |
| Answer consult | No | Yes | No | No |
| Advance demo clock / Reset demo data | No | No | No | Yes |
| Modify system configuration | No | No | No | Yes (audited) |

---

## 7. Data visibility and boundary rules

### 7.1 Visibility scopes definition

Data access is strictly bounded by role identity and provider organizational affiliation:
1. **Own-Provider Cases**: A DOCTOR or COORDINATOR has full operational visibility into cases originating within their own provider organization.
2. **Consented Referral Packets (Receiving Provider Scope)**: A DOCTOR or COORDINATOR of a receiving provider has visibility **only into the specific referral packet** (patient synthetic demographics, referral reason, approved explanation, and appointment/scheduling metadata) and **only after active patient consent has been granted**. They cannot access originating provider internal notes, unconsented history, or unrelated cases.
3. **Patient Scope**: A PATIENT has access strictly to their own cases, approved explanations, appointment details, notifications, and consent settings.
4. **Admin Scope**: An ADMIN has platform-wide operational and configuration visibility, but access to clinical content is strictly read-only and monitored by audit logs.

### 7.2 Field-level visibility matrix

| Field group | PATIENT | DOCTOR | COORDINATOR | ADMIN |
|---|---|---|---|---|
| Patient identity and DOB | Own only | Own-provider cases and consented referral packets | Own-provider cases and consented referral packets | Full visibility, read-only |
| Patient contact details | Own only | Own-provider cases and consented referral packets | Own-provider cases and consented referral packets | Full visibility, read-only |
| Clinical result summary | No | Own-provider cases and consented referral packets | No (sees approved explanation only) | Full visibility, read-only |
| Approved explanation | Own case only (after DOCTOR approval) | Own-provider cases and consented referral packets | Own-provider cases and consented referral packets | Full visibility, read-only |
| Urgency label (`intakeUrgency` & `urgencyLabel`) | Own case only | Own-provider cases and consented referral packets | Own-provider cases and consented referral packets | Full visibility, read-only |
| Recommended next step | Own case only | Own-provider cases and consented referral packets | Own-provider cases and consented referral packets | Full visibility, read-only |
| Referral and appointment records | Own case only | Own-provider cases and consented referral packets | Own-provider cases and consented referral packets | Full visibility, read-only |
| Consent records | Own only | Own-provider cases and consented referral packets | Own-provider cases and consented referral packets | Full visibility, read-only |
| Timeline events (`CaseEvent`) | Own case only | Own-provider cases and consented referral packets | Own-provider cases and consented referral packets | Full visibility, read-only |
| Audit trail (`AuditLog`) | Own case reads only | Own-provider cases and consented referral packets | Own-provider cases and consented referral packets | Full visibility, read-only |
| System / demo controls | No | No | No | Full access |

---

## 8. Delay reasons, configuration defaults, and metrics

### 8.1 Delay reasons taxonomy

Whenever an appointment is missed, rescheduled, or an SLA is breached, a mandatory delay reason must be selected:

| Reason code | Context of use |
|---|---|
| `PATIENT_UNREACHABLE` | Outreach attempts failed; patient has not responded to calls or messages. |
| `PROVIDER_DELAY` | Receiving specialist provider experiencing intake or acceptance backlog. |
| `NO_SLOT_AVAILABLE` | No clinical appointment slots available within the required SLA timeframe. |
| `APPOINTMENT_RESCHEDULED` | Patient or clinic requested rescheduling prior to appointment. |
| `PATIENT_DECLINED` | Patient expressed hesitation or unwillingness to attend. |
| `DOCUMENTATION_PENDING` | Missing diagnostic reports or external laboratory findings. |
| `TRANSPORT_OR_LOGISTICS` | Patient unable to travel to appointment location. |
| `OTHER` | Operational delay requiring free-text audit rationale. |

---

### 8.2 Central configuration parameters

| Setting | Routine value | Urgent value | Purpose and enforcement |
|---|---:|---:|---|
| Review after `NEW` | 48 h | 4 h | Time window for doctor review, explanation approval, and urgency confirmation. |
| Coordinator notification dispatch | 24 h | 4 h | Time window for coordinator to manually dispatch `result_reviewed`. |
| Patient acknowledgement window | 72 h | 24 h | Time window before patient non-acknowledgement triggers attention alert (+20). |
| Confirmatory result recording | 7 d | 48 h | Time window to record confirmatory test results in `CONFIRMATION_PENDING`. |
| Referral acceptance window | 3 d | 24 h | Time window for receiving provider coordinator to accept or reject referral. |
| Rejected-referral reassign window | 24 h | 4 h | Time window for sending coordinator to reassign a rejected referral. |
| Appointment scheduling window | 7 d | 48 h | Time window for receiving coordinator to book appointment after acceptance. |
| Consultation response window | 24 h | 4 h | Time window for clinician to answer submitted consult. |
| Default follow-up interval | 30 d | 30 d | Default interval for next milestone in `CARE_STARTED`. |
| Appointment attendance grace period | 2 d | 2 d | Time after the scheduled appointment before attendance or non-attendance is due. |
| Failed contact attempts threshold | 3 | 3 | Number of failed contact logs before raising repeated unreachable alert (+30). |
| Reassignment escalation threshold | 3 | 3 | Number of referral reassignments before automatic LEVEL_2 escalation. |
| **Escalation thresholds** | — | — | **Level 1**: Any SLA breach (`overdue > 0`) or consent revocation during active referral.<br>**Level 2**: `overdue >= 2 * SLA` OR 3 failed contacts OR 3 reassignments.<br>**Level 3**: `overdue >= 3 * SLA` OR Level 2 uncleared for >= 48h. |
| **Attention score weights** | — | — | Unassigned: +30<br>Notification unacknowledged: +20<br>Referral pending > SLA: +25<br>Rejected referral not reassigned: +25<br>Appointment overdue/missed: +25<br>Follow-up deadline missed: +20<br>Repeated unreachable: +30<br>Unanswered consult: +15<br>Generic state-SLA breach: +20<br>Overdue bonus: `+10 * floor(overdue / SLA)` (cap +40)<br>Urgent tier: +20 |
| **Attention levels** | — | — | LOW (< 30), MEDIUM (30–59), HIGH (>= 60) |

---

### 8.3 Analytics and metrics contract

All duration metrics report **median** and **90th percentile (P90)**. To prevent right-censoring bias (where recently opened cases artificially deflate completion percentages), **all rate metrics must explicitly specify their cohort basis**: either *cases created more than 30 days ago* or *closed cases only*.

#### Duration metrics (completed stages only)
- **Time to Review**: `reviewed_at - created_at` (measured across cases leaving `NEW`).
- **Time to Notification**: `first_notification_sent - reviewed_at` (measured across cases leaving `CLINICIAN_REVIEWED`).
- **Time to Acknowledgement**: `acknowledgedAt - first_notification_sent` (for cases where notification was sent).
- **Time to Confirmation**: `confirmation_recorded_at - entered_confirmation_pending_at`.
- **Time to Referral Acceptance**: `referral_accepted_at - referral_created_at`.
- **Time to Appointment Attendance**: `appointment_attended_at - referral_accepted_at`.
- **Time to Care Initiation**: `care_started_at - created_at`.

#### Rate metrics (cohort-defined)
- **Referral Acceptance Rate**:
  - *Cohort*: Cases created more than 30 days ago OR closed cases.
  - *Formula*: `accepted_referrals / (accepted_referrals + rejected_referrals)`.
- **Referral Completion Rate (Case-Level)**:
  - *Cohort*: Cases that entered `REFERRAL_PENDING` created more than 30 days ago OR closed cases.
  - *Formula*: `cases with an ATTENDED appointment / cases that entered REFERRAL_PENDING`.
- **Appointment Attendance Rate**:
  - *Cohort*: Scheduled appointments whose `scheduledAt < clock.now()` on cases created more than 30 days ago OR closed cases.
  - *Formula*: `ATTENDED_appointments / (ATTENDED_appointments + MISSED_appointments)`.
- **Care Initiation Rate**:
  - *Cohort*: Cases that entered `REFERRAL_PENDING` created more than 30 days ago OR closed cases.
  - *Formula*: `cases that reached CARE_STARTED / cases that entered REFERRAL_PENDING`.
- **Documented Closure Rate**:
  - *Cohort*: **Closed cases only**.
  - *Formula*: `cases closed with valid closure reason and required evidence / total closed cases` (100% by construction in CareLoop; serves as baseline comparative metric).
- **Patient Understanding Confirmation Rate**:
  - *Cohort*: Cases created more than 30 days ago OR closed cases where `result_reviewed` was dispatched.
  - *Formula*: `cases with UNDERSTANDING_CONFIRMED / cases with dispatched notification`.
- **SLA Breach Rate**:
  - *Cohort*: Cases created more than 30 days ago OR closed cases.
  - *Formula*: `state entries that breached SLA / total state entries`.
- **Drop-off Stage Distribution**:
  - *Cohort*: Closed cases with non-`COMPLETED_CARE` reason plus open cases currently at Escalation Level >= 2.
  - *Grouped by*: State in which drop-off or stall occurred (`CLINICIAN_REVIEWED`, `CONFIRMATION_PENDING`, `REFERRAL_PENDING`, `REFERRAL_ACCEPTED`, `APPOINTMENT_SCHEDULED`).
- **Fairness by Preferred Language**:
  - Outcome metrics (Acknowledgement %, Attendance %, Care Initiation %) grouped by `preferredLanguage` (`en`, `ar`, `other`).
  - Calculate gap versus overall population; suppress cohorts with `n < 10`.

---

## 9. Safety, ethics, and regulatory boundaries

1. **No Autonomous Clinical Decisions**: AI models and automated workflow rules never formulate clinical diagnoses, prescribe therapies, or override clinician judgment. Clinicians retain sole authority to approve summaries, next steps, confirmatory conclusions, and case closures.
2. **Operational vs. Clinical Urgency**: Priority algorithms measure operational backlog and drop-off risks. They are never labeled as triage scores or clinical risk indices.
3. **Synthetic Data Mandate**: In compliance with the innovation challenge scope, all patient identities, demographics, MRNs, and clinical findings are purely synthetic. No protected health information (PHI) is ever used.
4. **Information Minimization**: Outbox notifications and messaging channels contain zero clinical data or diagnoses.
5. **Non-repudiation and Auditing**: Every state change, owner assignment, explanation approval, and sensitive record read is written to an immutable append-only log.
6. **No Claim of Clinical Validation**: CareLoop is a proof-of-concept workflow coordination engine and has not undergone clinical trials or medical device certification.

---

## 10. Decisions

- **Pathway**: Adult comprehensive screening, abnormal finding.
- **Hosting**: Decided on Day 18; local Docker is the primary path.
- **LLM**: Template-only by default; an optional provider may be used behind the `ExplanationProvider` interface.
- **Outbox**: One in-app notification center with a simulated channel label.
- **Arabic**: Show an inline banner on the explanation plus a footer note stating that the Arabic text is not clinically reviewed.
