-- AlterTable
ALTER TABLE "ScreeningCase" ALTER COLUMN "id" SET DEFAULT ('CL-'::text || lpad(nextval('screening_case_id_seq'::regclass)::text, 4, '0'::text));
