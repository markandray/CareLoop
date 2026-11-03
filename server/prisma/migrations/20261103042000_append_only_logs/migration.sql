-- CaseEvent is the append-only patient timeline. AuditLog is the append-only
-- security and administrative trail. Reject row mutations at the database.
CREATE OR REPLACE FUNCTION reject_append_only_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION '% is append-only; % is not allowed', TG_TABLE_NAME, TG_OP
        USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "CaseEvent_reject_update_delete"
BEFORE UPDATE OR DELETE ON "CaseEvent"
FOR EACH ROW
EXECUTE FUNCTION reject_append_only_log_mutation();

CREATE TRIGGER "CaseEvent_reject_truncate"
BEFORE TRUNCATE ON "CaseEvent"
FOR EACH STATEMENT
EXECUTE FUNCTION reject_append_only_log_mutation();

CREATE TRIGGER "AuditLog_reject_update_delete"
BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW
EXECUTE FUNCTION reject_append_only_log_mutation();

CREATE TRIGGER "AuditLog_reject_truncate"
BEFORE TRUNCATE ON "AuditLog"
FOR EACH STATEMENT
EXECUTE FUNCTION reject_append_only_log_mutation();
