DROP INDEX "ExplanationDraft_caseId_language_createdAt_key";
CREATE INDEX "ExplanationDraft_caseId_language_createdAt_idx" ON "ExplanationDraft"("caseId", "language", "createdAt");
