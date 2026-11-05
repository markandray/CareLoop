# CareLoop

CareLoop is a synthetic screening-to-care coordination prototype. The server includes authentication, role checks, case read/create APIs, and the case transition endpoint; remaining modules are tracked in `TASKS.md`.

## Requirements

- Docker with the Compose plugin
- Node.js 22 or later and npm 10 or later for local workspace commands

## Run with Docker

From the repository root:

```sh
cp .env.example .env
docker compose up --build
```

Open the client at <http://localhost:3000>. The server health check is <http://localhost:4000/health> and returns `{"status":"OK"}`. Stop the attached services with `Ctrl+C`.

The values in `.env.example` are local placeholders, not production secrets. In particular, `JWT_SECRET` and `DEMO_PASSWORD` must be replaced outside a local demo. Do not reuse the demo password or check real secrets into the repository.

## Seed demo users

In another terminal, run the idempotent seed command:

```sh
npm run seed
```

This applies any pending migrations and creates three providers, staff accounts, and two synthetic patients (English and Arabic). Local demo login: `admin@careloop.local` (or another seeded account) with the `DEMO_PASSWORD` from `.env`; the example value is `CareLoopDemo2026!`. This is demo-only and must be changed before any hosted deployment.

## Auth curl examples

The API is rooted at `http://localhost:4000/api/v1`. These examples use the example demo password. If you changed `DEMO_PASSWORD`, use that value instead.

```sh
# Wrong password: HTTP 401 with the same generic response used for an unknown email.
curl -i http://localhost:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@careloop.local","password":"wrong"}'

# Login: saves the httpOnly, SameSite=Strict session cookie to a local cookie jar.
curl -i -c cookies.txt http://localhost:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@careloop.local","password":"CareLoopDemo2026!"}'

# Read the authenticated session.
curl -i -b cookies.txt http://localhost:4000/api/v1/auth/me

# Logout clears the cookie.
curl -i -b cookies.txt -c cookies.txt -X POST http://localhost:4000/api/v1/auth/logout

# The cleared cookie no longer authenticates.
curl -i -b cookies.txt http://localhost:4000/api/v1/auth/me
rm cookies.txt
```

## Create and read a case with curl

After seeding, look up the synthetic patient, screening provider, and doctor IDs
inside the Compose database container. The defaults below match the checked-in
`.env.example`; use your configured PostgreSQL user and database if you changed them.
Load the local demo password into the shell before using the commands:

```sh
set -a; . ./.env; set +a
```

```sh
PATIENT_ID="$(docker compose exec -T db psql -U careloop -d careloop -Atc \
  'SELECT id FROM "Patient" WHERE "syntheticMrn" = '\''MRN-SYN-0001'\'';')"
PROVIDER_ID="$(docker compose exec -T db psql -U careloop -d careloop -Atc \
  'SELECT id FROM "Provider" WHERE name = '\''Abu Dhabi Prevention Screening Centre'\'';')"
DOCTOR_ID="$(docker compose exec -T db psql -U careloop -d careloop -Atc \
  'SELECT id FROM "User" WHERE email = '\''doctor.screening@careloop.local'\'';')"

# Login and keep the httpOnly session cookie in the jar.
curl -i -c cookies.txt http://localhost:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"doctor.screening@careloop.local\",\"password\":\"$DEMO_PASSWORD\"}"

# Create a case. Copy case.id from the JSON response into CASE_ID below.
curl -i -b cookies.txt http://localhost:4000/api/v1/cases \
  -H 'Content-Type: application/json' \
  -d "{\"transitionKey\":\"CREATE_CASE\",\"evidence\":{\"patientId\":\"$PATIENT_ID\",\"originProviderId\":\"$PROVIDER_ID\",\"assignedDoctorId\":\"$DOCTOR_ID\",\"pathway\":\"Adult comprehensive screening, abnormal finding\",\"screeningType\":\"Comprehensive screening\",\"resultCategory\":\"Actionable synthetic finding\",\"preliminarySummary\":\"Synthetic intake summary for demonstration.\",\"recommendedAction\":\"Clinician review is required.\",\"intakeUrgency\":\"ROUTINE\"}}"

CASE_ID='CL-1001' # Replace with the case.id returned above.
curl -i -b cookies.txt "http://localhost:4000/api/v1/cases/$CASE_ID"
rm cookies.txt
```

`POST /cases` accepts only the strict `CREATE_CASE` request. The response contains
the role-specific case DTO and its `CASE_CREATED` event. A doctor from another
origin provider receives `404 NOT_FOUND` when reading the case.

## Consent and provider directory curl examples

After logging in as the synthetic patient, the patient can list current and prior consent rows, grant referral-sharing consent, and revoke a grant. A grant is retained as a separate row after revocation; duplicate active grants and repeated revocation return `409 CONFLICT`.

```sh
# Set PROVIDER_ID to the receiving provider ID from the provider directory.
curl -i -b patient-cookies.txt http://localhost:4000/api/v1/providers
curl -i -b patient-cookies.txt http://localhost:4000/api/v1/patients/me/consents
curl -i -b patient-cookies.txt http://localhost:4000/api/v1/patients/me/consents \
  -H 'Content-Type: application/json' \
  -d "{\"providerId\":\"$PROVIDER_ID\",\"scope\":\"CROSS_PROVIDER_REFERRAL\"}"

# Copy consent.id from the grant response.
CONSENT_ID='replace-with-consent-id'
curl -i -b patient-cookies.txt -X POST \
  "http://localhost:4000/api/v1/patients/me/consents/$CONSENT_ID/revoke"

# Staff can see a directory with names and roles only; email/password fields are not returned.
curl -i -b staff-cookies.txt "http://localhost:4000/api/v1/providers/$PROVIDER_ID/staff"
```

Revocation immediately removes receiving-provider access to the current referral packet, case reads, and lifecycle transitions. A new consent grant restores that access. Revoking consent for an active referral raises a human-facing LEVEL_1 operational escalation.

## Notifications, acknowledgement, and understanding curl examples

Log in as the coordinator at the case's origin provider. Reviewing a case creates a queued `result_reviewed` notification; the coordinator dispatches it only after an approved explanation exists. The other workflow notifications are sent automatically into the in-app outbox. Text comes from the neutral localized template catalog.

```sh
curl -i -c coordinator-cookies.txt http://localhost:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"coordinator.screening@careloop.local","password":"CareLoopDemo2026!"}'

curl -i -b coordinator-cookies.txt \
  'http://localhost:4000/api/v1/notifications?limit=50'

# Use the queued result_reviewed notification ID from the response.
NOTIFICATION_ID='replace-with-notification-id'
curl -i -b coordinator-cookies.txt -X POST \
  "http://localhost:4000/api/v1/notifications/$NOTIFICATION_ID/dispatch" \
  -H 'Content-Type: application/json' -d '{}'
```

The patient can then view their localized notification and acknowledge it. Acknowledgement and understanding confirmation record patient actions without advancing the case workflow state.

```sh
curl -i -c patient-cookies.txt http://localhost:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"patient.en@careloop.local","password":"CareLoopDemo2026!"}'

curl -i -b patient-cookies.txt http://localhost:4000/api/v1/notifications
curl -i -b patient-cookies.txt -X POST \
  "http://localhost:4000/api/v1/notifications/$NOTIFICATION_ID/acknowledge" \
  -H 'Content-Type: application/json' -d '{}'

# Understanding requires an approved explanation ID belonging to this case.
CASE_ID='replace-with-case-id'
EXPLANATION_ID='replace-with-approved-explanation-id'
curl -i -b patient-cookies.txt -X POST \
  "http://localhost:4000/api/v1/cases/$CASE_ID/understanding" \
  -H 'Content-Type: application/json' \
  -d "{\"explanationId\":\"$EXPLANATION_ID\"}"
```

An origin-provider doctor or coordinator can ask the patient to review a cross-provider sharing request. The endpoint sends a neutral `consent_needed` notification automatically.

```sh
curl -i -b coordinator-cookies.txt -X POST \
  "http://localhost:4000/api/v1/cases/$CASE_ID/consent-requests" \
  -H 'Content-Type: application/json' \
  -d "{\"providerId\":\"$PROVIDER_ID\"}"
```

## Transition curl examples

The transition endpoint uses the expected current state and a strict, key-specific
evidence object. These examples assume the case has a saved doctor review draft and
approved English/Arabic explanation drafts before `REVIEW_CASE`, and a current
pending referral before `ACCEPT_REFERRAL`. Those prerequisites are created by the
review/explanation and referral workflows; do not substitute server-derived IDs
other than the approved explanation IDs or current referral ID shown here.

```sh
CASE_ID='CL-1001' # Replace with the human-readable ID of the prepared case.
EN_EXPLANATION_ID='00000000-0000-0000-0000-000000000001'
AR_EXPLANATION_ID='00000000-0000-0000-0000-000000000002'

# Log in as the doctor assigned to the NEW case.
curl -i -c doctor-cookies.txt http://localhost:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"doctor.screening@careloop.local\",\"password\":\"$DEMO_PASSWORD\"}"

# Save the approved review. The response contains the doctor role's case DTO and event.
curl -i -b doctor-cookies.txt -X POST \
  "http://localhost:4000/api/v1/cases/$CASE_ID/transitions" \
  -H 'Content-Type: application/json' \
  -d "{\"transitionKey\":\"REVIEW_CASE\",\"expectedState\":\"NEW\",\"evidence\":{\"approvedExplanationIds\":[\"$EN_EXPLANATION_ID\",\"$AR_EXPLANATION_ID\"]}}"

# A current pending referral ID is returned in the origin-side REFERRAL_CREATED event.
REFERRAL_ID='00000000-0000-0000-0000-000000000003' # Replace with that referral ID.
curl -i -c receiving-cookies.txt http://localhost:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"coordinator.hospital@careloop.local\",\"password\":\"$DEMO_PASSWORD\"}"

# Accept the current referral as a coordinator at its receiving provider.
curl -i -b receiving-cookies.txt -X POST \
  "http://localhost:4000/api/v1/cases/$CASE_ID/transitions" \
  -H 'Content-Type: application/json' \
  -d "{\"transitionKey\":\"ACCEPT_REFERRAL\",\"expectedState\":\"REFERRAL_PENDING\",\"evidence\":{\"referralId\":\"$REFERRAL_ID\"}}"

rm doctor-cookies.txt receiving-cookies.txt
```

The receiving-provider response is a `ReferralPacket`; its event payload is
redacted. A stale `expectedState` returns `409 CONFLICT` in the standard error
envelope.

## Tests

Run unit tests:

```sh
npm test
```

The database is reachable only inside the Compose network. Create `careloop_test` once in the existing database container, then run the database-backed core and auth tests. This command targets `careloop_test`; it does not use the demo database.

```sh
docker compose up -d db
docker compose exec -T db createdb -U careloop careloop_test
npm run test:db
```

If `careloop_test` already exists, skip the `createdb` command. The tests apply pending migrations and create only synthetic test records there. PostgreSQL has no published host port.

## Run workspace apps locally

Install dependencies with `npm install`, provide the environment values from `.env.example` in the shell, then run `npm run dev:server` and `npm run dev:client` in separate terminals. A local PostgreSQL service is required by the server.

## First-half demo: clinician review through patient understanding

Start the stack and seed it as above. This walkthrough uses the seeded origin doctor, coordinator, and English patient. Copy each returned case, explanation, notification, and event ID into the shell variables as indicated; IDs are generated by the database.

```sh
set -a; . ./.env; set +a
PATIENT_ID="$(docker compose exec -T db psql -U careloop -d careloop -Atc 'SELECT id FROM "Patient" WHERE "syntheticMrn" = '\''MRN-SYN-0001'\'';')"
PROVIDER_ID="$(docker compose exec -T db psql -U careloop -d careloop -Atc 'SELECT id FROM "Provider" WHERE name = '\''Abu Dhabi Prevention Screening Centre'\'';')"
DOCTOR_ID="$(docker compose exec -T db psql -U careloop -d careloop -Atc 'SELECT id FROM "User" WHERE email = '\''doctor.screening@careloop.local'\'';')"

# Admin creates a synthetic case (the doctor can also create it).
curl -i -c admin-cookies.txt http://localhost:4000/api/v1/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"admin@careloop.local\",\"password\":\"$DEMO_PASSWORD\"}"
curl -i -b admin-cookies.txt http://localhost:4000/api/v1/cases -H 'Content-Type: application/json' \
  -d "{\"transitionKey\":\"CREATE_CASE\",\"evidence\":{\"patientId\":\"$PATIENT_ID\",\"originProviderId\":\"$PROVIDER_ID\",\"assignedDoctorId\":\"$DOCTOR_ID\",\"pathway\":\"Synthetic screening pathway\",\"screeningType\":\"Synthetic screening\",\"resultCategory\":\"Actionable synthetic finding\",\"preliminarySummary\":\"Synthetic intake for demonstration.\",\"recommendedAction\":\"Clinician review required.\",\"intakeUrgency\":\"ROUTINE\"}}"
CASE_ID='replace-with-case-id-from-response'

# Doctor saves structured review fields, then generates one draft per language.
curl -i -c doctor-cookies.txt http://localhost:4000/api/v1/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"doctor.screening@careloop.local\",\"password\":\"$DEMO_PASSWORD\"}"
curl -i -b doctor-cookies.txt -X PUT "http://localhost:4000/api/v1/cases/$CASE_ID/review-draft" \
  -H 'Content-Type: application/json' \
  -d '{"resultCategoryCode":"FOLLOW_UP_NEEDED","nextStepCode":"SPECIALIST_REFERRAL","urgencyLabel":"ROUTINE","route":"REFERRAL","doctorNote":"Please discuss the next step with your care team."}'
curl -i -b doctor-cookies.txt -X POST "http://localhost:4000/api/v1/cases/$CASE_ID/explanations/generate" \
  -H 'Content-Type: application/json' -d '{}'
```

Approve each returned explanation ID. A repeated generate call before edits returns the same current rows.

```sh
EN_EXPLANATION_ID='replace-with-EN-id'
AR_EXPLANATION_ID='replace-with-AR-id'
curl -i -b doctor-cookies.txt -X POST "http://localhost:4000/api/v1/cases/$CASE_ID/explanations/$EN_EXPLANATION_ID/approve" \
  -H 'Content-Type: application/json' -d '{}'
curl -i -b doctor-cookies.txt -X POST "http://localhost:4000/api/v1/cases/$CASE_ID/explanations/$AR_EXPLANATION_ID/approve" \
  -H 'Content-Type: application/json' -d '{}'
curl -i -b doctor-cookies.txt -X POST "http://localhost:4000/api/v1/cases/$CASE_ID/transitions" \
  -H 'Content-Type: application/json' \
  -d "{\"transitionKey\":\"REVIEW_CASE\",\"expectedState\":\"NEW\",\"evidence\":{\"approvedExplanationIds\":[\"$EN_EXPLANATION_ID\",\"$AR_EXPLANATION_ID\"]}}"
```

The origin coordinator dispatches the queued `result_reviewed` notification after review. Copy its notification ID from the notification list response.

```sh
curl -i -c coordinator-cookies.txt http://localhost:4000/api/v1/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"coordinator.screening@careloop.local\",\"password\":\"$DEMO_PASSWORD\"}"
curl -i -b coordinator-cookies.txt 'http://localhost:4000/api/v1/notifications?limit=50'
NOTIFICATION_ID='replace-with-result_reviewed-notification-id'
curl -i -b coordinator-cookies.txt -X POST "http://localhost:4000/api/v1/notifications/$NOTIFICATION_ID/dispatch" \
  -H 'Content-Type: application/json' -d '{}'
```

The patient lists notifications, acknowledges the dispatched item, reads approved current explanations, and confirms understanding using the EN explanation ID.

```sh
curl -i -c patient-cookies.txt http://localhost:4000/api/v1/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"patient.en@careloop.local\",\"password\":\"$DEMO_PASSWORD\"}"
curl -i -b patient-cookies.txt http://localhost:4000/api/v1/notifications
curl -i -b patient-cookies.txt -X POST "http://localhost:4000/api/v1/notifications/$NOTIFICATION_ID/acknowledge" \
  -H 'Content-Type: application/json' -d '{}'
curl -i -b patient-cookies.txt "http://localhost:4000/api/v1/cases/$CASE_ID/explanations"
curl -i -b patient-cookies.txt -X POST "http://localhost:4000/api/v1/cases/$CASE_ID/understanding" \
  -H 'Content-Type: application/json' -d "{\"explanationId\":\"$EN_EXPLANATION_ID\"}"
```

Receiving-provider staff can reject a pending referral with a reason. The case remains in
`REFERRAL_PENDING`; ownership and its 24 h routine / 4 h urgent reassignment deadline return to
the origin coordinator queue. Referral and appointment history use cursor pagination.

```sh
REFERRAL_ID='replace-with-pending-referral-id'
curl -i -b coordinator-receiving-cookies.txt "http://localhost:4000/api/v1/cases/$CASE_ID/referrals?limit=25"
curl -i -b coordinator-receiving-cookies.txt -X POST "http://localhost:4000/api/v1/referrals/$REFERRAL_ID/reject" \
  -H 'Content-Type: application/json' \
  -d '{"rejectionReason":"No capacity at this provider"}'
curl -i -b coordinator-receiving-cookies.txt "http://localhost:4000/api/v1/referrals/$REFERRAL_ID/appointments?limit=25"
```

The coordinator contact-attempt API derives the current workflow milestone from the case. Do not
send referral or appointment IDs; the strict request schema rejects them.

```sh
curl -i -b coordinator-cookies.txt -X POST "http://localhost:4000/api/v1/cases/$CASE_ID/contact-attempts" \
  -H 'Content-Type: application/json' \
  -d '{"channel":"PHONE","outcome":"NO_ANSWER","delayReason":"PATIENT_UNREACHABLE","notes":"Synthetic attempt."}'
curl -i -b coordinator-cookies.txt "http://localhost:4000/api/v1/cases/$CASE_ID/contact-attempts?limit=25"
```

Staff can read the rules-based attention queue. The level is operational and is calculated when queried;
it does not represent clinical urgency. Filter the list to MEDIUM or HIGH, or ask for one visible case:

```sh
curl -i -b coordinator-cookies.txt 'http://localhost:4000/api/v1/attention/cases?minLevel=MEDIUM&limit=25'
curl -i -b coordinator-cookies.txt "http://localhost:4000/api/v1/cases/$CASE_ID/attention"
curl -i -b coordinator-cookies.txt 'http://localhost:4000/api/v1/cases?attentionOnly=true&limit=25'
```

The queue accepts `providerId` to filter by origin provider and an opaque `cursor` from the prior page.
Patients receive 403. The response label is `Operational workflow rule, not a clinical risk assessment.`

### Demonstrate an overdue escalation and resolve it

This creates an urgent, unassigned synthetic case, advances the admin demo clock past its four-hour
review window, shows the escalated queue item, and resolves it with an operational action plan and
delay reason. Use the `PATIENT_ID` and `PROVIDER_ID` values from the setup above; copy the returned
case ID into `CASE_ID`.

```sh
curl -i -c doctor-cookies.txt http://localhost:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"doctor.screening@careloop.local\",\"password\":\"$DEMO_PASSWORD\"}"

curl -i -b doctor-cookies.txt http://localhost:4000/api/v1/cases \
  -H 'Content-Type: application/json' \
  -d "{\"transitionKey\":\"CREATE_CASE\",\"evidence\":{\"patientId\":\"$PATIENT_ID\",\"originProviderId\":\"$PROVIDER_ID\",\"pathway\":\"Synthetic screening\",\"screeningType\":\"Synthetic screen\",\"resultCategory\":\"Synthetic finding\",\"preliminarySummary\":\"Synthetic intake summary.\",\"recommendedAction\":\"Clinician review required.\",\"intakeUrgency\":\"URGENT\"}}"

CASE_ID='replace-with-case-id-from-response'
curl -i -c admin-cookies.txt http://localhost:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"admin@careloop.local\",\"password\":\"$DEMO_PASSWORD\"}"
curl -i -b admin-cookies.txt -X POST http://localhost:4000/api/v1/demo/clock/advance \
  -H 'Content-Type: application/json' -d '{"amount":5,"unit":"HOURS"}'
curl -i -b admin-cookies.txt \
  "http://localhost:4000/api/v1/attention/cases?providerId=$PROVIDER_ID&minEscalation=LEVEL_1&limit=25"

curl -i -c coordinator-cookies.txt http://localhost:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"coordinator.screening@careloop.local\",\"password\":\"$DEMO_PASSWORD\"}"
curl -i -b coordinator-cookies.txt -X POST \
  "http://localhost:4000/api/v1/cases/$CASE_ID/escalation/resolve" \
  -H 'Content-Type: application/json' \
  -d '{"actionPlan":"Assign the case to the doctor and confirm the next workflow step.","delayReason":"PROVIDER_DELAY"}'
```

Resolution clears the overlay, records an immutable event and audit row, and starts a fresh SLA
window for the current case state. Only a doctor may resolve LEVEL_2 or LEVEL_3; the admin can
advance the demo clock but cannot resolve cases.
