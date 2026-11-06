# Assumptions, Dependencies, and Limitations

## Assumptions

- All people, screening results, providers, referrals, appointments, and workflow records are synthetic.
- Providers and screening sources are simulated; there are no live connections to laboratories or health records.
- Screening results already exist when a case is created. A clinician enters or approves clinical content, the next step, urgency label, explanation draft, and any non-completed closure decision.
- Notifications are simulated in an in-app outbox. No message is delivered by SMS, email, WhatsApp, or another external channel.
- SLA durations are illustrative operational settings, not clinical standards. The workflow is a proposal and is not a clinical protocol.
- The cohort simulation uses documented assumptions and does not estimate real-world effects.
- The demo login helper and its public demo password are for local synthetic use only. `NEXT_PUBLIC_*` values are embedded in browser assets; production builds must set `NEXT_PUBLIC_DEMO_MODE=false` and omit `NEXT_PUBLIC_DEMO_PASSWORD`.
- Demo users and seeded passwords are public synthetic credentials and must never be reused for real services.

## Dependencies

- Node.js 22 or later and npm 10 or later for workspace commands.
- Docker with the Compose plugin and PostgreSQL for the reproducible local run.
- Prisma for database schema and migrations; runtime configuration is supplied through environment variables documented in `.env.example`.
- The explanation catalog works without an external service. An optional LLM provider and real email or messaging service may be integrated later; neither is required or active in the default prototype.
- A real deployment would additionally require EHR/HIE integration, an approved messaging gateway, an identity provider, and hosting in the required data-residency boundary.

## Limitations

- No real patient data, clinical-system integration, lab integration, or external message delivery is included.
- The workflow has not undergone clinical validation and must not be treated as medical advice or a clinical protocol.
- No clinician has reviewed the patient-facing catalog wording. Arabic explanations and translations are template-generated and have not been clinically reviewed.
- The prototype models one illustrative screening pathway; its SLA values are assumptions. Clinical-sounding catalog content is placeholder material for human review.
- Simulation inputs are assumptions rather than empirical effect sizes. Fairness has not been established on real populations.
- The application has not received an independent security audit.
- Login rate limiting is in memory and is suitable only for a single server instance.
- The login page's demo accounts panel is deliberately demo-only. Its credentials are visible to browser users when enabled; production builds must disable it and omit the public password variable.
- API milestone checks enforce consistency between recorded actions and workflow transitions; a patient acknowledgement does not by itself prove clinical understanding.
- Attention list pages recalculate scores on each request. If cases or the demo clock change between pages, an item's position can move across an opaque cursor.
- The periodic escalation sweep uses a single-instance advisory lock and has no distributed job queue; event-triggered escalations are written in their triggering transaction.
- `npm run demo:reset` destroys all data in the configured development database before reseeding it. It is refused in production and unless `ALLOW_DEMO_RESET=true` is set.
