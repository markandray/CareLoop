import { createHash } from 'node:crypto';
import { ExplanationOutputSchema, type ExplanationOutput, type Language, type ReviewDraftFields } from '@careloop/shared';
import { fixedSentences, nextSteps, resultCategories } from './catalog';

export interface ExplanationProvider {
  generate(fields: ReviewDraftFields, language: Language): ExplanationOutput;
}

function canonicalFields(fields: ReviewDraftFields): string {
  return JSON.stringify({
    doctorNote: fields.doctorNote ?? null,
    nextStepCode: fields.nextStepCode,
    resultCategoryCode: fields.resultCategoryCode,
    route: fields.route,
    urgencyLabel: fields.urgencyLabel,
  });
}

export function hashExplanationInput(fields: ReviewDraftFields): string {
  return createHash('sha256').update(canonicalFields(fields), 'utf8').digest('hex');
}

export class TemplateExplanationProvider implements ExplanationProvider {
  generate(fields: ReviewDraftFields, language: Language): ExplanationOutput {
    const lang = language === 'AR' ? 'AR' : 'EN';
    const resultMeaning = resultCategories[fields.resultCategoryCode as keyof typeof resultCategories]?.[lang];
    const nextStep = nextSteps[fields.nextStepCode as keyof typeof nextSteps]?.[lang];
    if (!resultMeaning || !nextStep) throw new Error('Unknown explanation catalog code.');
    const output = {
      language: lang,
      sections: {
        resultMeaning,
        nextStep,
        meaningAndDiagnosis: fixedSentences[lang].meaningAndDiagnosis,
        contactClinic: fixedSentences[lang].contactClinic,
        limitations: fixedSentences[lang].limitations,
        doctorNote: fields.doctorNote ?? null,
      },
      disclaimer: fixedSentences[lang].disclaimer,
      clinicallyReviewed: false,
      ...(lang === 'AR' ? { notTranslatedNote: fixedSentences.AR.notTranslatedNote } : {}),
      inputHash: hashExplanationInput(fields),
    };
    return ExplanationOutputSchema.parse(output);
  }
}
