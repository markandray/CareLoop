-- Every non-terminal case must carry the due date for its current milestone.
ALTER TABLE "ScreeningCase"
    DROP CONSTRAINT "ScreeningCase_closure_fields_check",
    ADD CONSTRAINT "ScreeningCase_closure_fields_check"
    CHECK (
        ("state" = 'CLOSED' AND "closureReason" IS NOT NULL AND "closedAt" IS NOT NULL
            AND "dueAt" IS NULL AND "ownerUserId" IS NULL AND "ownerQueueRole" IS NULL
            AND "ownerQueueProviderId" IS NULL)
        OR
        ("state" <> 'CLOSED' AND "closureReason" IS NULL AND "closedAt" IS NULL
            AND "dueAt" IS NOT NULL)
    );
