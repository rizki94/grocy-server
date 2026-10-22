-- Truncate existing journals if any to allow NOT NULL UNIQUE constraint
TRUNCATE TABLE "journal_entries" CASCADE;
TRUNCATE TABLE "journals" CASCADE;

-- Add invoice column to journals table (NOT NULL and UNIQUE)
ALTER TABLE "journals" ADD COLUMN IF NOT EXISTS "invoice" text;
ALTER TABLE "journals" ALTER COLUMN "invoice" SET NOT NULL;
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'journals_invoice_unique'
    ) THEN
        ALTER TABLE "journals" ADD CONSTRAINT "journals_invoice_unique" UNIQUE ("invoice");
    END IF;
END $$;

-- Add journal prefix columns to settings table
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "general_journal_prefix" text DEFAULT 'JRL' NOT NULL;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "expense_journal_prefix" text DEFAULT 'EXP' NOT NULL;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "sales_journal_prefix" text DEFAULT 'SLS' NOT NULL;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "purchase_journal_prefix" text DEFAULT 'PUR' NOT NULL;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "ar_payment_journal_prefix" text DEFAULT 'AR' NOT NULL;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "ap_payment_journal_prefix" text DEFAULT 'AP' NOT NULL;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "sales_return_journal_prefix" text DEFAULT 'SLR' NOT NULL;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "purchase_return_journal_prefix" text DEFAULT 'PCR' NOT NULL;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "adjustment_journal_prefix" text DEFAULT 'ADJ' NOT NULL;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "pos_journal_prefix" text DEFAULT 'POS' NOT NULL;
