import { z } from 'zod';

export const UuidSchema = z.string().uuid();
export const CaseIdSchema = z.string().regex(/^CL-\d{4,}$/);
export const UtcTimestampSchema = z.string().datetime({ offset: false });
export const DateOnlySchema = z.string().date();
export const CursorSchema = z.string().min(1).max(512);
export const PageLimitSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(100)
  .default(25);
export const NoteSchema = z.string().trim().min(1).max(2000);
export const DelayReasonNoteSchema = z.string().trim().min(1).max(1000);

export const CursorQuerySchema = z
  .object({
    cursor: CursorSchema.optional(),
    limit: PageLimitSchema,
  })
  .strict();

export const makeCursorPageSchema = <T extends z.ZodTypeAny>(item: T) =>
  z
    .object({
      items: z.array(item),
      nextCursor: CursorSchema.nullable(),
      // Snapshot time for the list response; individual items retain their own timestamps.
      updatedAt: UtcTimestampSchema,
    })
    .strict();

export const SuccessSchema = z.object({ ok: z.literal(true) }).strict();

export const ApiErrorCodeSchema = z.enum([
  'INVALID_TRANSITION',
  'EVIDENCE_MISSING',
  'FORBIDDEN',
  'CONSENT_REQUIRED',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'DELAY_REASON_REQUIRED',
  'RATE_LIMITED',
  'CONFLICT',
  'INTERNAL_ERROR',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorSchema = z
  .object({
    error: z
      .object({
        code: ApiErrorCodeSchema,
        message: z.string(),
        details: z.unknown().optional(),
      })
      .strict(),
  })
  .strict();
export type ApiError = z.infer<typeof ApiErrorSchema>;
