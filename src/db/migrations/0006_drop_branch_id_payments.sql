-- Migration: Drop branch_id from payments table
-- This is part of the schema simplification

DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_branch_id_branches_id_fk') THEN
        ALTER TABLE "payments" DROP CONSTRAINT "payments_branch_id_branches_id_fk";
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'payments' AND column_name = 'branch_id') THEN
        ALTER TABLE "payments" DROP COLUMN "branch_id";
    END IF;
END $$;
