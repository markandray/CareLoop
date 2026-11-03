# Product Requirements

CareLoop converts each actionable screening result into a single, auditable case with one owner, one next action, one due date, and one workflow state. The product is intentionally operational and accountability-focused: it prioritizes communication, case ownership, and escalation without allowing autonomous clinical decision-making.

This document is the product-level contract for the lifecycle, referral rules, permissions, attention engine, escalation policy, patient communications, and analytics defined in AGENTS.md sections 6 and 8. SLA values are illustrative configuration and not clinical standards.

## 1. Workflow contract

### 1.1 Lifecycle transition table (one row per transition)

| From state | To state | Actor role | Precondition | Evidence required | Owner and dueAt after transition | Notification template key | Event type |
|---|---|---|---|---|---|---|---|
| NEW | CLINICIAN_REVIEWED | DOCTOR | The case is assigned to a doctor and is ready for review. | Approved result summary, recommended next step, urgency label, and the route chosen (confirmation or referral) recorded as evidence. | Owner becomes the COORDINATOR queue; dueAt = now + 24h for the coordinator notification task. | `result_reviewed` | `CASE_REVIEWED` |
| CLINICIAN_REVIEWED | CONFIRMATION_PENDING | COORDINATOR | The doctor selected the confirmation route and a confirmation task is created. | Notification record for the patient; route selected; approved explanation attached before dispatch. | Owner becomes DOCTOR; dueAt = now + 7d. | `awaiting_confirmation` | `CONFIRMATION_REQUESTED` |
| CLINICIAN_REVIEWED | REFERRAL_PENDING | COORDINATOR | The doctor selected the referral route and a valid referral can be created. | Referral record created; route selected; active consent record required if sender and receiving provider differ; approved explanation attached before dispatch. | Owner becomes COORDINATOR; dueAt = now + 3d. | `referral_started` | `REFERRAL_CREATED` |
| CLINICIAN_REVIEWED | CLOSED | DOCTOR | The coordinator proposes closure and a DOCTOR signs off. | Closure reason and evidence; if not COMPLETED_CARE, documented reason plus clinician sign-off. | Owner becomes null; dueAt = null. | `care_closed` | `CLOSURE_PROPOSED` / `CASE_CLOSED` |
| CONFIRMATION_PENDING | REFERRAL_PENDING | DOCTOR | A confirmatory result is recorded and referral is required. | Confirmatory result record; valid referral record created. | Owner becomes COORDINATOR; dueAt = now + 3d. | `referral_started` | `REFERRAL_CREATED` |
| CONFIRMATION_PENDING | CLOSED | DOCTOR | The coordinator proposes closure after confirmation or decline, and a DOCTOR signs off. | Closure reason, evidence, and sign-off if required. | Owner becomes null; dueAt = null. | `care_closed` | `CLOSURE_PROPOSED` / `CASE_CLOSED` |
| REFERRAL_PENDING | REFERRAL_ACCEPTED | RECEIVING-PROVIDER USER | A DOCTOR or COORDINATOR of the receiving provider accepts the referral and consent is valid if provider differs. | Referral acceptance event; receiving-provider identity; provider mapping. | Owner becomes the receiving provider's coordinator queue; dueAt = now + 7d. | `referral_accepted` | `REFERRAL_ACCEPTED` |
| REFERRAL_PENDING | REFERRAL_PENDING (reassigned) | COORDINATOR | The current referral is rejected or invalid and a new referral row is created. | New referral row, rejection reason (if applicable), reassignment count incremented, and an escalation decision if the threshold is reached. | Owner remains COORDINATOR; dueAt resets to now + 3d for the new referral row. | `referral_reassigned` | `REFERRAL_REASSIGNED` |
| REFERRAL_ACCEPTED | APPOINTMENT_SCHEDULED | COORDINATOR | The receiving provider's coordinator schedules the appointment. | Appointment date and time recorded against the accepted referral. | Owner becomes the receiving provider's coordinator queue; dueAt = appointment time + 2d. | `appointment_scheduled` | `APPOINTMENT_SCHEDULED` |
| APPOINTMENT_SCHEDULED | CARE_STARTED | RECEIVING CLINICIAN | The patient attended the appointment and care begins. | Attended-appointment evidence and care-start documentation. | Owner becomes RECEIVING CLINICIAN; dueAt = follow-up date or next milestone. | `care_started` | `CARE_STARTED` |
| APPOINTMENT_SCHEDULED | APPOINTMENT_SCHEDULED (rescheduled) | COORDINATOR | The appointment is missed, delayed, or needs rescheduling. | Delay reason required; reschedule action recorded. | Owner remains COORDINATOR; dueAt = new appointment time + 2d. | `appointment_rescheduled` | `APPOINTMENT_RESCHEDULED` |
| CARE_STARTED | CLOSED | DOCTOR | Care or surveillance plan exists and closure is justified. | Care plan or documented treatment evidence; closure reason and sign-off present. | Owner becomes null; dueAt = null. | `care_closed` | `CLOSURE_PROPOSED` / `CASE_CLOSED` |

Design rationale: the workflow stays explicit and auditable by tying every state change to a real event, a named actor, and evidence. It also keeps one owner and one dueAt for each open case, which makes the queue and escalation rules explainable and testable.

### 1.2 In-state events (non-transition)

These events do not change workflow state but are recorded as timeline entries and may trigger operational actions:

- NOTIFICATION_SENT
- NOTIFICATION_ACKNOWLEDGED
- CONTACT_ATTEMPT_LOGGED
- REFERRAL_REJECTED
- CONSULT_REQUESTED
- CONSULT_ANSWERED
- ESCALATION_RAISED
- ESCALATION_CLEARED
- CONSENT_GRANTED
- CONSENT_REVOKED
- DELAY_REASON_RECORDED
- EXPLANATION_APPROVED
- CLOSURE_PROPOSED

Design rationale: event logging keeps visible work and patient communication separate from state transitions, which means the system can represent non-stateful actions without breaking the lifecycle model.

### 1.3 Closure matrix

| Closure reason | Allowed states | Required evidence | Sign-off |
|---|---|---|---|
| COMPLETED_CARE | CARE_STARTED only | Attended-appointment evidence plus a documented treatment or surveillance plan. | DOCTOR |
| NOT_CONFIRMED | CONFIRMATION_PENDING only | Documented reason for no confirmatory result. | DOCTOR |
| PATIENT_DECLINED | CLINICIAN_REVIEWED, CONFIRMATION_PENDING, REFERRAL_PENDING, APPOINTMENT_SCHEDULED | Patient-decline record and documented reason. | DOCTOR |
| UNREACHABLE_AFTER_ATTEMPTS | REFERRAL_PENDING, APPOINTMENT_SCHEDULED, CONFIRMATION_PENDING | Contact-attempt log, escalation evidence, and final patient-unreachable record. | DOCTOR |
| TRANSFERRED_OUT | REFERRAL_PENDING, APPOINTMENT_SCHEDULED, CARE_STARTED | Transfer or referral destination evidence. | DOCTOR |

CLOSED is terminal. No further workflow state changes are allowed after closure except a final status display or an audited read.

Design rationale: the closure matrix keeps closure rare and justified, while still allowing the system to end a case once there is enough evidence and a clinician has approved the final status.

### 1.4 Routine versus urgent SLA tiers

| State or action | Routine SLA | Urgent SLA |
|---|---:|---:|
| Review after NEW | 48 h | 4 h |
| Patient notification after CLINICIAN_REVIEWED | 24 h | 4 h |
| Referral acceptance after REFERRAL_PENDING | 3 d | 24 h |
| Appointment scheduling after REFERRAL_ACCEPTED | 7 d | 48 h |
| Confirmation after entry to CONFIRMATION_PENDING | 7 d | 48 h |
| Consultation response | 24 h | 4 h |

Design rationale: urgent cases are treated as operational exceptions without changing the underlying lifecycle, which makes the SLA logic simple and auditable while still handling the higher-risk cases faster.

## 2. Referral and receiving-provider rules

### 2.1 Receiving-provider user definition

A receiving-provider user is a DOCTOR or COORDINATOR whose provider assignment matches the receiving provider on the referral. Only a receiving-provider user may accept or reject a referral. A non-matching user may view a case only if access and consent rules permit it, but may not accept or reject the referral.

Design rationale: this keeps referral accountability tied to the provider that actually receives the patient and prevents unauthorized acceptance by unrelated staff.

### 2.2 Consent before cross-provider referral

Consent is required only when sender and receiving provider differ. If the sender and receiving provider are the same provider, no extra consent record is required for the referral itself. When providers differ, an active consent record for the patient and relevant referral scope must exist before the referral can be created, accepted, or viewed by the receiving provider. Consent may be granted or revoked by the patient and is auditable.

Design rationale: consent is enforced only at the cross-provider boundary so the platform remains compliant without making routine same-provider work unnecessarily heavy.

### 2.3 Reassignment policy

A reassignment creates a new referral row, not a modification of the original row. The policy is:

- a new referral row is created with a new referralId;
- the case remains REFERRAL_PENDING;
- dueAt resets to now + 3d from the reassignment timestamp;
- the reassignment count increments; and
- after N reassignments (default: 3), the case escalates to the human queue.

If a referral is rejected, the case cannot continue without an explicit reassignment or escalation step.

Design rationale: using new referral rows preserves the case history and makes the timeline traceable even when the same case is sent to multiple providers.

## 3. Notification model and patient-facing status mapping

### 3.1 Notification dispatch

Notification dispatch is an explicit COORDINATOR action on state entry. The template is queued on state entry and the COORDINATOR dispatches it. Dispatch requires an APPROVED explanation and a valid patient-facing message. Notification content must be fixed template text and must not contain diagnosis detail.

The template keys are:

- `result_reviewed`
- `awaiting_confirmation`
- `referral_started`
- `referral_accepted`
- `referral_reassigned`
- `appointment_scheduled`
- `appointment_rescheduled`
- `care_started`
- `care_closed`
- `followup_due`
- `unreachable_retry`
- `consult_pending`

Design rationale: fixed template keys make the approval, dispatch, and audit trail deterministic and safer than free-form patient messaging.

### 3.2 Patient-facing status mapping

| Workflow state | Patient-facing label |
|---|---|
| NEW | Review in progress |
| CLINICIAN_REVIEWED | Next step planned |
| CONFIRMATION_PENDING | Waiting for confirmation |
| REFERRAL_PENDING | Referral being arranged |
| REFERRAL_ACCEPTED | Referral accepted |
| APPOINTMENT_SCHEDULED | Appointment booked |
| APPOINTMENT_SCHEDULED (rescheduled) | Appointment updated |
| CARE_STARTED | Care started |
| CLOSED + COMPLETED_CARE | Care completed |
| CLOSED + PATIENT_DECLINED | Care declined by patient |
| CLOSED + NOT_CONFIRMED | Follow-up not confirmed |
| CLOSED + UNREACHABLE_AFTER_ATTEMPTS | Patient could not be reached |
| CLOSED + TRANSFERRED_OUT | Transferred to another provider |

The patient-facing wording for declined, unreachable, or not-confirmed closure reasons must not say that no further action is needed.

Design rationale: patient labels are operational and plain-language, which keeps the status tracker understandable without leaking clinical language or implying a medical risk grade.

## 4. Explanation approval flow and urgency labels

### 4.1 Explanation approval flow

The explanation is generated only from clinician-approved structured fields: result category, approved summary, recommended next step, and urgency label. The system never derives patient-facing explanation text from raw clinical data or free diagnosis text.

Flow:

1. DOCTOR approves the result summary and recommended next step.
2. The explanation generator creates a template-based localized draft in English or Arabic.
3. The draft is saved as ExplanationDraft.
4. DOCTOR or an authorized clinician approves the final version.
5. PATIENT can view the approved explanation only after approval.
6. If the explanation validation fails, the template is used as the fallback and the rejection is recorded.

Design rationale: the patient only sees vetted language, which reduces risk and preserves the safety boundary defined in AGENTS.md.

### 4.2 Urgency labels

Urgency labels are operational labels, not clinical risk assessments. Allowed values are:

- ROUTINE
- URGENT

URGENT selects the urgent SLA tier. The label must not be presented as a clinical diagnosis or medical risk severity score.

Design rationale: urgency is kept operational and explainable so the workflow remains aligned with the challenge requirement and does not masquerade as clinical severity.

## 5. Attention engine, escalation, and scoring

### 5.1 Attention thresholds and scoring rule

Attention is scored on operational delay risk, not medical severity. Each rule may contribute points; the total score determines the attention level. The label must always include: "Operational workflow rule, not a clinical risk assessment."

| Rule | Points |
|---|---:|
| Unassigned case | 30 |
| Notification not acknowledged after SLA | 20 |
| Referral pending longer than SLA | 25 |
| Appointment overdue or missed | 25 |
| Follow-up deadline missed | 20 |
| Rejected referral not reassigned | 25 |
| Repeated unreachable patient | 30 |
| Unanswered consult after SLA | 15 |
| Generic state-SLA breach | 20 |
| +10 per full SLA period overdue | +10 each, cap +30 |
| +20 for the urgent tier | +20 |

Scoring rule:

- LOW: score < 30
- MEDIUM: 30-59
- HIGH: score >= 60

The generic state-SLA-breach rule fires only if no specific rule applies to that state.

Worked example: a REFERRAL_PENDING case that has crossed SLA while the case is in the urgent tier.

- Base referral-pending rule: +25
- Urgent tier: +20
- One full SLA period overdue: +10
- Total: 55 => MEDIUM

When the same case remains unresolved and crosses a second full SLA period overdue, the total becomes 65 => HIGH.

Design rationale: the attention score combines delay severity and urgency, which makes the queue naturally rise from medium to high as the case stays unresolved longer.

### 5.2 Attention rules list

| Rule | Plain-language reason text |
|---|---|
| Unassigned case | "This case has no owner assigned and has not been accepted into the workflow queue." |
| Notification not acknowledged | "The patient received the result notification but has not acknowledged it within the configured time window." |
| Referral pending longer than SLA | "This referral has remained pending longer than the configured service-level time." |
| Appointment overdue or missed | "The appointment is overdue or was missed, and no recovery step has been recorded yet." |
| Follow-up deadline missed | "A required follow-up action is past due and still open." |
| Rejected referral not reassigned | "A provider rejected this referral, but it has not been reassigned or escalated." |
| Repeated unreachable patient | "The patient has had repeated failed contact attempts and is still not reachable." |
| Unanswered consult | "A consultation request remains unanswered beyond the configured response window." |
| Generic state-SLA breach | "This case is past its due date for the current workflow state and requires action." |

### 5.3 Escalation section

Escalation is an overlay on a case and does not change the underlying workflow state.

| Escalation level | Trigger | Recipient | How cleared |
|---|---|---|---|
| LEVEL_0 | No escalation | None | Not applicable |
| LEVEL_1 | One SLA breach or contact-failure threshold reached | COORDINATOR queue | Corrective action recorded and dueAt reset or case resolved |
| LEVEL_2 | Multiple breaches, repeated reassignments, or unresolved open issues | DOCTOR queue and ADMIN | Human review and explicit resolution record |
| LEVEL_3 | Critical workflow failure, repeated non-response, or unresolved issue across provider boundaries | ADMIN review / human override queue | Explicit sign-off and closure or reassignment |

Escalation is cleared by a recorded corrective action that reduces the cause to zero, such as acceptance, reassignment, rescheduling, patient contact, or documented closure. Escalation does not replace the evidence requirement.

Default threshold values are:

- failed contact attempts: 3
- reassignments before escalation: 3

Design rationale: escalation remains an overlay so the case continues to have its original workflow state while still being visible in the right human queue.

## 6. Role and permission model

### 6.1 Role and permission matrix

| Role | Allowed case visibility | Permission summary |
|---|---|---|
| PATIENT | Own case set only | View own case status, explanation, appointments, notifications, acknowledge notices, grant/revoke consent, decline care, request consult |
| DOCTOR | Provider-scoped assigned cases and valid cross-provider cases with consent | Review and approve summaries, set urgency, record confirmatory result, create referrals, accept or reject referrals, answer consults, propose closure, sign off closure |
| COORDINATOR | Assigned or queue-managed cases | Manage referrals, schedule appointments, log contact attempts, reassign referrals, resolve escalation, send notifications, propose closure |
| ADMIN | Read-only on workflow and clinical content; full access to demo, seed, and configuration data | View dashboards and system configuration, seed data, manage demo controls, user management, and configuration; no workflow write without audit trail |

### 6.2 Action x role permission table

| Action | PATIENT | DOCTOR | COORDINATOR | ADMIN |
|---|---|---|---|---|
| Create case | No | Yes | No | No |
| View own case details | Yes | Yes, if assigned or provider-valid | Yes, if assigned | Yes |
| View other patients' data | No | No, unless explicit consent and policy allow | No, unless explicit consent and policy allow | Read-only by system policy, not direct override |
| Approve explanation | No | Yes | No | No |
| Set urgency label | No | Yes | No | No |
| Record confirmatory result | No | Yes | No | No |
| Record attendance | No | Yes, if receiving clinician | No | No |
| Create referral | No | Yes | Yes | No |
| Accept referral | No | Yes, if receiving-provider user | Yes, if receiving-provider user | No |
| Reject referral | No | Yes, if receiving-provider user | Yes, if receiving-provider user | No |
| Reassign referral | No | No | Yes | No |
| Schedule appointment | No | No | Yes | No |
| Log contact attempt | No | No | Yes | No |
| Request consult | Yes | Yes | No | No |
| Answer consult | No | Yes | No | No |
| Resolve escalation | No | Yes | Yes | Yes, read-only resolution support only |
| Propose closure | No | No | Yes | No |
| Sign off closure | No | Yes | No | No |
| Grant or revoke consent | Yes | No | No | No |
| Acknowledge notification | Yes | No | No | No |
| Decline care | Yes | No | No | No |
| View analytics dashboard | No | No | No | Yes |
| Advance demo time | No | No | No | Yes |
| Change configuration or user data | No | No | No | Yes, but audited and restricted to admin management scope |

Design rationale: the permission model keeps the workflow readable and safe by separating operational work from clinical sign-off and by ensuring that admin access remains a read-only oversight role unless the action is an auditable admin management task.

## 7. Field-level visibility

| Field group | PATIENT | DOCTOR | COORDINATOR | ADMIN |
|---|---|---|---|---|
| Patient identity and DOB | Own only | Provider-scoped within own scope | Provider-scoped within own scope | Full visibility, read-only |
| Contact details | Own only | Provider-scoped within own scope | Full contact details for assigned/queue cases | Full visibility, read-only |
| Clinical result summary | No | Provider-scoped when relevant | No | Full visibility, read-only |
| Urgency | Own case only | Provider-scoped within own scope | Full urgency for assigned/queue cases | Full visibility, read-only |
| Next step / recommended action | Own case only | Provider-scoped within own scope | Full next-step data for assigned/queue cases | Full visibility, read-only |
| Referral data | Own case only | Provider-scoped within own scope | Full referral and appointment metadata | Full visibility, read-only |
| Consent records | Own only | Provider-scoped within own scope | Provider-scoped within own scope | Full visibility, read-only |
| Timeline events | Own case only | Provider-scoped within own scope | Full event view for assigned/queue cases | Full visibility, read-only |
| Audit log | Own case only, limited read | Provider-scoped within own scope | Assigned/queue case audit view | Full visibility, read-only |
| Demo / seed controls | No | No | No | Yes |

Design rationale: field visibility is concrete and deterministic so each role sees only the data needed for its operating boundary and no more.

## 8. Delay reasons, configuration defaults, and metrics

### 8.1 Delay-reason list

| Delay reason | Used when |
|---|---|
| PATIENT_UNREACHABLE | No patient response or follow-up contact is possible. |
| PROVIDER_DELAY | The receiving provider is slow to respond or process the referral. |
| APPOINTMENT_RESCHEDULED | The appointment was moved to a later date. |
| PATIENT_DECLINED | The patient declined care or participation. |
| NO_SLOT_AVAILABLE | There are no available appointment slots. |
| DOCUMENTATION_PENDING | Clinical documentation is incomplete. |
| OTHER | Any other operational delay requiring review. |

### 8.2 Configuration defaults table

| Setting | Routine | Urgent | Purpose |
|---|---:|---:|---|
| Review after NEW | 48 h | 4 h | Time to review a newly created case. |
| Notification after CLINICIAN_REVIEWED | 24 h | 4 h | Time to send patient notification. |
| Referral acceptance after REFERRAL_PENDING | 3 d | 24 h | Time for receiving provider to accept the referral. |
| Appointment scheduling after REFERRAL_ACCEPTED | 7 d | 48 h | Time to book the appointment. |
| Confirmation after entry to CONFIRMATION_PENDING | 7 d | 48 h | Time to record confirmatory result. |
| Consultation response | 24 h | 4 h | Time to answer an unanswered consult. |
| Failed contact attempts threshold | 3 | 3 | Number of failed attempts before escalation. |
| Reassignment threshold | 3 | 3 | Number of reassignments before escalation. |

Design rationale: central defaults keep SLA tuning simple while still allowing urgent work to move sooner without reworking the state model.

### 8.3 Metrics

All time metrics must report median and P90. Open cases are excluded from time metrics and counted in unresolved.

- Time to review = reviewed_at - created_at
- Time to notification = first NOTIFICATION_SENT - reviewed_at (also report created_at -> first notification)
- Time to acknowledgement = acknowledgedAt - first notification sent
- Time to confirmation = confirmatory result recorded - entry to CONFIRMATION_PENDING
- Time to consultation = first consult answer - consult request
- Time to referral acceptance = accepted_at - referral created (plus reassignment count)
- Time to care = CARE_STARTED event - created_at
- Referral acceptance rate = accepted / (accepted + rejected)
- Referral completion (case level) = cases with an ATTENDED appointment / cases that entered REFERRAL_PENDING
- Appointment attendance % = ATTENDED / (ATTENDED + MISSED), past appointments only
- Care initiation % = cases that reached CARE_STARTED / cases that entered REFERRAL_PENDING
- Unresolved actionable cases = open cases with a non-null owner and dueAt
- SLA breach rate = state entries that breached SLA / all state entries
- Drop-off by stage = cases closed with a non-COMPLETED reason or stuck and overdue, grouped by the state they ended in
- Documented closure % = closed with reason + evidence/sign-off / closed (note: 100% by construction in CareLoop; meaningful versus the baseline)
- Patient understanding proxy = % acknowledged within SLA and % who pressed "I understand"
- Fairness: report each outcome metric by preferredLanguage with the gap versus overall; suppress groups with n < 10.

Design rationale: the metric set is grounded in the same event log and evidence records as the workflow, which keeps operational reporting honest and directly comparable across stages and language groups.

## 9. Safety and privacy constraints

- AI does not make or change clinical decisions. Doctors approve result summaries, next steps, urgency, and closure.
- Operational priority is never presented as clinical urgency or diagnosis severity.
- All data is synthetic and must never include real patient data.
- Notifications and logs never include diagnosis details.
- Reads of patient detail are audited.
- Consent controls cross-provider visibility when provider differs.
- ADMIN access is read-only on workflow and clinical content; any admin write is audited.
- The product may never claim clinical validation.

Design rationale: these constraints preserve the intended safety boundary while keeping the application within the challenge’s approved operational scope.

## 10. Open questions

- Which screening pathway label should be used in the demo story?
- What is the hosting target for the live demo?
- Should the auth/RBAC baseline be reused from an existing codebase or built cleanly in this project?
- Is an optional LLM key available, or is the system expected to run with template-only explanation output?

Design rationale: these are the only unresolved product decisions; they are listed here instead of being guessed so the implementation remains faithful to the approved scope and architecture.
