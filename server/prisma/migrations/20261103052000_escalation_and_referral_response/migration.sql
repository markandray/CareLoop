ALTER TABLE "ScreeningCase"
    ADD COLUMN "escalatedAt" TIMESTAMPTZ(3),
    ADD CONSTRAINT "ScreeningCase_escalated_at_matches_level_check"
    CHECK (
        ("escalationLevel" = 'LEVEL_0' AND "escalatedAt" IS NULL)
        OR ("escalationLevel" <> 'LEVEL_0' AND "escalatedAt" IS NOT NULL)
    );

ALTER TABLE "Referral"
    ADD COLUMN "respondedAt" TIMESTAMPTZ(3),
    ADD CONSTRAINT "Referral_accepted_or_rejected_has_response_time_check"
    CHECK ("status" NOT IN ('ACCEPTED', 'REJECTED') OR "respondedAt" IS NOT NULL);
