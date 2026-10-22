DO $$ BEGIN
    CREATE TYPE "bank_reconciliation_status" AS ENUM('draft', 'reconciled', 'cancelled');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "bank_reconciliations" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "code" text NOT NULL UNIQUE,
    "name" text NOT NULL,
    "bank_account_id" uuid NOT NULL REFERENCES "gl_accounts"("id"),
    "reconciliation_date" date NOT NULL,
    "opening_balance" numeric(12, 2) NOT NULL DEFAULT 0,
    "statement_balance" numeric(12, 2) NOT NULL DEFAULT 0,
    "cleared_balance" numeric(12, 2) NOT NULL DEFAULT 0,
    "difference" numeric(12, 2) NOT NULL DEFAULT 0,
    "status" "bank_reconciliation_status" NOT NULL DEFAULT 'draft',
    "note" text,
    "branch_id" uuid REFERENCES "branches"("id"),
    "created_by" uuid NOT NULL REFERENCES "users"("id"),
    "reconciled_by" uuid REFERENCES "users"("id"),
    "reconciled_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "bank_reconciliation_items" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "bank_reconciliation_id" uuid NOT NULL REFERENCES "bank_reconciliations"("id") ON DELETE CASCADE,
    "journal_entry_id" uuid REFERENCES "journal_entries"("id"),
    "transaction_date" date NOT NULL,
    "reference" text,
    "description" text,
    "debit" numeric(12, 2) NOT NULL DEFAULT 0,
    "credit" numeric(12, 2) NOT NULL DEFAULT 0,
    "is_cleared" boolean NOT NULL DEFAULT false,
    "cleared_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);
