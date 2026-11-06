# AI and explanation design

## Operational attention rules engine

CareLoop uses deterministic operational rules instead of ML because this prototype has no validated outcome labels, and the queue must explain each handoff delay in language a coordinator can act on. The score is computed from the current case snapshot on each read. It is never stored, and it does not estimate disease severity or choose care.

For an open case, the engine adds the configured points for every matching rule in Product Requirements §5.2. It adds an overdue bonus of `min(40, 10 * floor(overdueBy / currentStateSlaDuration))` when the case due date has passed, then adds 20 for the urgent operational timer tier. `overdueBy` is the non-negative elapsed time after the case's current `dueAt`; the SLA duration comes from the current workflow state and urgency in `workflowConfig.ts`. The state fallback table in Product Requirements §5.3 determines whether a generic state SLA breach can fire. Parallel rules for an unacknowledged `result_reviewed` notification, an unanswered consult, and repeated failed outreach can stack with a state rule. A CLOSED case returns zero and no reasons.

Scores below 30 are LOW, 30 through 59 are MEDIUM, and 60 or more are HIGH. Each reason uses the fixed plain-language copy listed in the API contract, while `suggestedAction` is a separate action selected from the highest-scoring reason. Both are digit-free and contain no denylisted clinical terms. If only `URGENT_TIER` applies, the action is `No action needed yet.` Its reason is `This case is on the urgent timer.` The response always carries the exact label `Operational workflow rule, not a clinical risk assessment.` The workflow clock is injected, so advancing demo time changes the score without timers or sleeps.

Worked example from Product Requirements §5.4: an urgent case in `REFERRAL_PENDING` has a 24 h SLA, a 25 point pending-referral rule, and the 20 point urgent-tier bonus. At 1 h overdue its overdue bonus is 0 and the total is 45 (MEDIUM). At 24 h overdue it is 55 (MEDIUM). At 48 h it is 65 (HIGH). At 96 h the overdue bonus is capped at 40 and the total is 85 (HIGH). The weights and SLA durations are illustrative operational configuration, not clinical standards.

## Escalation sweep

The escalation sweep uses the same pure `overdueInfo(snapshot, now, workflowConfig)` calculation as attention, so both features agree on overdue milliseconds and full SLA periods. The level policy preserves the stored level, raises L1 after the first overdue instant, L2 at two complete periods, and L3 at three periods or when a stored L2 has remained uncleared for at least 48 hours. Closed cases map to L0. These thresholds are operational demonstration settings, not clinical standards.

`runEscalationSweep` obtains a PostgreSQL transaction advisory lock, loads open case snapshots in batches, and appends one system `ESCALATION_RAISED` event plus an audit row for each increase. It never lowers levels; unchanged facts produce no additional writes. A server interval (60 seconds by default, disabled with `ESCALATION_SWEEP_INTERVAL_MS=0`) invokes it using the injected clock. Failed contacts, referral reassignments, and consent revocations are handled at their triggering event transaction and are not recalculated by the sweep. Level 2 is triggered on the third reassignment.

Resolution is an audited human action. A scoped coordinator or doctor can clear L1; only a doctor can clear L2/L3. The action plan is retained in the append-only event payload. If currently overdue, a delay reason is mandatory. The service resets the due date from the current state and urgency and clears `escalatedAt`; no case state transition is made.

## Deterministic explanation catalog

Patient-facing explanations use a small, version-controlled bilingual catalog. Stable result-category and next-step codes select short English or Arabic sentences; fixed catalog text supplies the meaning, clinic-contact, limitation, and disclaimer sections. This keeps wording reviewable, predictable, and usable without a network service or API key. Catalog text is deliberately generic and does not name diseases, medicines, doses, or numeric thresholds. Arabic output is marked `clinicallyReviewed: false` and carries a visible note that it has not been clinically reviewed.

The only provider in this task is `TemplateExplanationProvider`. It returns byte-identical JSON for identical structured fields and language. A SHA-256 hash is computed from canonical JSON with explicit field ordering, including the optional doctor note. The note is retained only in its dedicated `doctorNote` section; it does not alter any explanatory body sentence.

## Safety rules and validation

The provider accepts only `ReviewDraftFields`: stable result category and next-step codes, clinician-set operational urgency, route, and an optional doctor note. It does not accept raw screening data or call an LLM. Text is checked for Unicode digits, English and Arabic denylist terms for diagnoses and medicines/doses, and exact membership in the language catalog. The doctor note must match the dedicated note field and must not appear in any body section. Metadata and the input hash are checked as well.

`generateValidatedExplanation` returns the generated text only when validation passes. A validation failure returns a fresh template result and a reason code (`DIGIT_FOUND`, `DENYLIST_TERM`, `NON_CATALOG_SENTENCE`, `DOCTOR_NOTE_LEAK`, `INVALID_METADATA`, or `INVALID_INPUT_HASH`). A provider exception also falls back to the template. These checks are safety guards for this prototype, not clinical validation; a clinician must approve drafts before a patient can see them.

## Future provider extension

An LLM could later implement the same `ExplanationProvider.generate(fields, language)` interface. It would remain optional and disabled by default. Any proposed rewrite would pass through the same validator, with the deterministic template as fallback. This task makes no LLM calls and adds no LLM dependency.

## API approval flow

A doctor scoped to the case origin provider saves the structured `ReviewDraftFields` only while the case is `NEW`. Generation validates the bilingual catalog output and persists one template row per language with the canonical SHA-256 input hash. A repeated generation for the unchanged hash returns those rows; a changed draft produces a new pair and preserves older rows as history. Doctors approve each current draft separately. Approval records the injected clock time, actor, immutable case event and audit row. Patient and coordinator reads include only approved rows whose hash matches the present review draft; doctor reads include history with a current/stale flag. `REVIEW_CASE` rechecks both approved language rows against the current hash inside transition fact loading, so editing a draft invalidates prior approvals without deleting them.
