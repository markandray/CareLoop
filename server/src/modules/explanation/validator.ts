import { catalogSentences, fixedSentences } from './catalog';
import type { ExplanationOutput, Language, ReviewDraftFields } from '@careloop/shared';
import type { ExplanationProvider } from './provider';
import { TemplateExplanationProvider } from './provider';

export type ExplanationValidationReason = 'DIGIT_FOUND' | 'DENYLIST_TERM' | 'NON_CATALOG_SENTENCE' | 'DOCTOR_NOTE_LEAK' | 'INVALID_METADATA' | 'INVALID_INPUT_HASH';
export type ExplanationValidation = { valid: true } | { valid: false; reasonCode: ExplanationValidationReason };

// Terms here are specific diagnoses and medicines; the generic required phrase "not a diagnosis" is catalog text.
const denylist = /\b(?:cancer|tumou?r|carcinoma|diabetes|hypertension|asthma|stroke|infection|aspirin|ibuprofen|paracetamol|acetaminophen|insulin|metformin|mg|dose|dosage|tablet|capsule)\b/i;

export function validateExplanation(output: ExplanationOutput, fields: ReviewDraftFields): ExplanationValidation {
  if (output.inputHash !== new TemplateExplanationProvider().generate(fields, output.language).inputHash) {
    return { valid: false, reasonCode: 'INVALID_INPUT_HASH' };
  }
  if (output.clinicallyReviewed !== false || output.language === 'AR' && !output.notTranslatedNote || output.language !== 'AR' && output.notTranslatedNote) {
    return { valid: false, reasonCode: 'INVALID_METADATA' };
  }
  const textSections = [output.sections.resultMeaning, output.sections.nextStep, output.sections.meaningAndDiagnosis,
    output.sections.contactClinic, output.sections.limitations, output.disclaimer, ...(output.notTranslatedNote ? [output.notTranslatedNote] : [])];
  if (output.sections.doctorNote !== (fields.doctorNote ?? null)) return { valid: false, reasonCode: 'DOCTOR_NOTE_LEAK' };
  if (fields.doctorNote && textSections.some((text) => text.includes(fields.doctorNote!))) return { valid: false, reasonCode: 'DOCTOR_NOTE_LEAK' };
  if (textSections.some((text) => /\d/.test(text)) || output.sections.doctorNote && /\d/.test(output.sections.doctorNote)) return { valid: false, reasonCode: 'DIGIT_FOUND' };
  if (textSections.some((text) => denylist.test(text)) || output.sections.doctorNote && denylist.test(output.sections.doctorNote)) return { valid: false, reasonCode: 'DENYLIST_TERM' };
  const allowed = new Set(catalogSentences(output.language as Language));
  if (textSections.some((text) => !allowed.has(text))) return { valid: false, reasonCode: 'NON_CATALOG_SENTENCE' };
  return { valid: true };
}

export function generateValidatedExplanation(provider: ExplanationProvider, fields: ReviewDraftFields, language: Language): { output: ExplanationOutput; fallbackReasonCode: ExplanationValidationReason | null } {
  let candidate: ExplanationOutput;
  try {
    candidate = provider.generate(fields, language);
  } catch {
    return { output: new TemplateExplanationProvider().generate(fields, language), fallbackReasonCode: 'NON_CATALOG_SENTENCE' };
  }
  const validation = validateExplanation(candidate, fields);
  if (validation.valid) return { output: candidate, fallbackReasonCode: null };
  return { output: new TemplateExplanationProvider().generate(fields, language), fallbackReasonCode: validation.reasonCode };
}
