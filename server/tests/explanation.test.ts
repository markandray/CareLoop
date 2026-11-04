import { describe, expect, it } from 'vitest';
import type { ExplanationOutput, ReviewDraftFields } from '@careloop/shared';
import { catalogSentences, fixedSentences, nextSteps, resultCategories } from '../src/modules/explanation/catalog';
import { TemplateExplanationProvider, hashExplanationInput } from '../src/modules/explanation/provider';
import { generateValidatedExplanation, validateExplanation } from '../src/modules/explanation/validator';

const fields: ReviewDraftFields = {
  resultCategoryCode: 'FOLLOW_UP_NEEDED',
  nextStepCode: 'SPECIALIST_REFERRAL',
  urgencyLabel: 'ROUTINE',
  route: 'REFERRAL',
};
const provider = new TemplateExplanationProvider();
const copy = (output: ExplanationOutput): ExplanationOutput => structuredClone(output);

describe('template explanations', () => {
  it('is deterministic byte for byte', () => {
    const a = JSON.stringify(provider.generate(fields, 'EN'));
    const b = JSON.stringify(provider.generate(fields, 'EN'));
    expect(a).toBe(b);
  });

  it('has English and Arabic entries for every stable catalog code', () => {
    for (const entry of [...Object.values(resultCategories), ...Object.values(nextSteps)]) {
      expect(entry.EN.length).toBeGreaterThan(0);
      expect(entry.AR.length).toBeGreaterThan(0);
    }
  });

  it('uses only catalog sentences in generated sections', () => {
    for (const language of ['EN', 'AR'] as const) {
      const output = provider.generate(fields, language);
      const allowed = new Set(catalogSentences(language));
      for (const [key, value] of Object.entries(output.sections)) {
        if (key !== 'doctorNote' && value !== null) expect(allowed.has(value)).toBe(true);
      }
      expect(allowed.has(output.disclaimer)).toBe(true);
      expect(validateExplanation(output, fields)).toEqual({ valid: true });
    }
  });

  it('rejects injected digits', () => {
    const output = copy(provider.generate(fields, 'EN'));
    output.sections.contactClinic = `${fixedSentences.EN.contactClinic} Call 2.`;
    expect(validateExplanation(output, fields)).toEqual({ valid: false, reasonCode: 'DIGIT_FOUND' });
  });

  it('rejects Arabic-Indic digits too', () => {
    const output = copy(provider.generate(fields, 'AR'));
    output.sections.contactClinic = `${fixedSentences.AR.contactClinic} ٢`;
    expect(validateExplanation(output, fields)).toEqual({ valid: false, reasonCode: 'DIGIT_FOUND' });
  });

  it('rejects a drug name', () => {
    const output = copy(provider.generate(fields, 'EN'));
    output.sections.contactClinic = 'Ask about aspirin at your clinic.';
    expect(validateExplanation(output, fields)).toEqual({ valid: false, reasonCode: 'DENYLIST_TERM' });
  });

  it('rejects an invented sentence', () => {
    const output = copy(provider.generate(fields, 'EN'));
    output.sections.contactClinic = 'Everything will be fine.';
    expect(validateExplanation(output, fields)).toEqual({ valid: false, reasonCode: 'NON_CATALOG_SENTENCE' });
  });

  it('rejects a doctor note copied into a body section and falls back', () => {
    const withNote = { ...fields, doctorNote: 'Please contact the clinic.' };
    const output = copy(provider.generate(withNote, 'EN'));
    output.sections.contactClinic = `Please contact the clinic. ${output.sections.contactClinic}`;
    expect(validateExplanation(output, withNote)).toEqual({ valid: false, reasonCode: 'DOCTOR_NOTE_LEAK' });
    const fallback = generateValidatedExplanation({ generate: () => output }, withNote, 'EN');
    expect(fallback.fallbackReasonCode).toBe('DOCTOR_NOTE_LEAK');
    expect(fallback.output.sections.contactClinic).toBe(fixedSentences.EN.contactClinic);
  });

  it('flags Arabic output as not clinically reviewed', () => {
    const output = provider.generate(fields, 'AR');
    expect(output.clinicallyReviewed).toBe(false);
    expect(output.notTranslatedNote).toBe(fixedSentences.AR.notTranslatedNote);
  });

  it('changes the input hash for every structured field', () => {
    const base = hashExplanationInput(fields);
    const variants: ReviewDraftFields[] = [
      { ...fields, resultCategoryCode: 'ROUTINE_FINDING' },
      { ...fields, nextStepCode: 'CONFIRMATORY_TEST' },
      { ...fields, urgencyLabel: 'URGENT' },
      { ...fields, route: 'CONFIRMATION' },
      { ...fields, doctorNote: 'A clinician note.' },
    ];
    for (const variant of variants) expect(hashExplanationInput(variant)).not.toBe(base);
  });

  it('keeps body text unchanged when only doctorNote changes', () => {
    const first = provider.generate(fields, 'EN');
    const second = provider.generate({ ...fields, doctorNote: 'A clinician note.' }, 'EN');
    expect({ ...first.sections, doctorNote: null }).toEqual({ ...second.sections, doctorNote: null });
    expect(first.inputHash).not.toBe(second.inputHash);
  });
});
