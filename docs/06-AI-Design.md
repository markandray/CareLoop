# AI and explanation design

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
