ALTER TABLE "ScreeningCase"
ADD COLUMN "reviewDraftSummary" TEXT,
ADD COLUMN "reviewDraftNextStep" TEXT,
ADD COLUMN "reviewDraftUrgencyLabel" "Urgency",
ADD COLUMN "reviewRoute" VARCHAR(16);

ALTER TABLE "ScreeningCase"
ADD CONSTRAINT "ScreeningCase_reviewRoute_check"
CHECK ("reviewRoute" IS NULL OR "reviewRoute" IN ('CONFIRMATION', 'REFERRAL'));

ALTER TABLE "ScreeningCase"
ADD CONSTRAINT "ScreeningCase_reviewDraft_complete_check"
CHECK (
  ("reviewDraftSummary" IS NULL AND "reviewDraftNextStep" IS NULL AND "reviewDraftUrgencyLabel" IS NULL)
  OR
  ("reviewDraftSummary" IS NOT NULL AND "reviewDraftNextStep" IS NOT NULL AND "reviewDraftUrgencyLabel" IS NOT NULL)
);
