ALTER TABLE "ExplanationDraft" ADD COLUMN "inputHash" VARCHAR(64) NOT NULL DEFAULT repeat('0', 64);
ALTER TABLE "ScreeningCase" ADD COLUMN "reviewDraftDoctorNote" TEXT;
