-- Create incomes and income_lines tables
CREATE TABLE IF NOT EXISTS "incomes" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "code" text NOT NULL UNIQUE,
    "date" date NOT NULL,
    "deposit_account_id" uuid NOT NULL REFERENCES "gl_accounts"("id"),
    "branch_id" uuid NOT NULL REFERENCES "branches"("id"),
    "user_id" uuid NOT NULL REFERENCES "users"("id"),
    "total_amount" numeric(12, 2) NOT NULL DEFAULT 0,
    "reference" text,
    "description" text,
    "status" text NOT NULL DEFAULT 'draft',
    "journal_id" uuid REFERENCES "journals"("id") ON DELETE SET NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "income_lines" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "income_id" uuid NOT NULL REFERENCES "incomes"("id") ON DELETE CASCADE,
    "gl_account_id" uuid NOT NULL REFERENCES "gl_accounts"("id"),
    "amount" numeric(12, 2) NOT NULL DEFAULT 0,
    "note" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "settings"
    ADD COLUMN IF NOT EXISTS "income_prefix" text NOT NULL DEFAULT 'INC',
    ADD COLUMN IF NOT EXISTS "income_journal_prefix" text NOT NULL DEFAULT 'INC';
