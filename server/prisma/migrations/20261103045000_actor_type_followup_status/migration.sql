-- Actor attribution distinguishes authenticated users from system actions.
CREATE TYPE "ActorType" AS ENUM ('USER', 'SYSTEM');

ALTER TABLE "CaseEvent" ADD COLUMN "actorType" "ActorType";
UPDATE "CaseEvent"
SET "actorType" = CASE WHEN "actorId" IS NULL THEN 'SYSTEM'::"ActorType" ELSE 'USER'::"ActorType" END;
ALTER TABLE "CaseEvent"
    ALTER COLUMN "actorType" SET DEFAULT 'USER',
    ALTER COLUMN "actorType" SET NOT NULL,
    ADD CONSTRAINT "CaseEvent_user_actor_id_check"
        CHECK ("actorType" <> 'USER' OR "actorId" IS NOT NULL);

ALTER TABLE "AuditLog" ADD COLUMN "actorType" "ActorType";
UPDATE "AuditLog"
SET "actorType" = CASE WHEN "actorId" IS NULL THEN 'SYSTEM'::"ActorType" ELSE 'USER'::"ActorType" END;
ALTER TABLE "AuditLog"
    ALTER COLUMN "actorType" SET DEFAULT 'USER',
    ALTER COLUMN "actorType" SET NOT NULL,
    ADD CONSTRAINT "AuditLog_user_actor_id_check"
        CHECK ("actorType" <> 'USER' OR "actorId" IS NOT NULL);

-- This field already exists in the scaffold migration; IF NOT EXISTS keeps
-- this corrective migration safe across the existing schema history.
ALTER TABLE "Appointment"
    ADD COLUMN IF NOT EXISTS "delayReason" "DelayReason";

CREATE TYPE "FollowUpStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');
ALTER TABLE "FollowUp" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "FollowUp"
    ALTER COLUMN "status" TYPE "FollowUpStatus"
    USING "status"::text::"FollowUpStatus";
ALTER TABLE "FollowUp" ALTER COLUMN "status" SET DEFAULT 'OPEN';
