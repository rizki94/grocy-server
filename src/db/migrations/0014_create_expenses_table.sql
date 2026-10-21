-- Create expenses and expense_lines tables
CREATE TABLE IF NOT EXISTS "expenses" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "code" text NOT NULL UNIQUE,
    "date" date NOT NULL,
    "payment_account_id" uuid NOT NULL REFERENCES "gl_accounts"("id"),
    "branch_id" uuid NOT NULL REFERENCES "branches"("id"),
    "user_id" uuid NOT NULL REFERENCES "users"("id"),
    "total_amount" numeric(12, 2) NOT NULL DEFAULT 0,
    "reference" text,
    "description" text,
    "status" text NOT NULL DEFAULT 'posted',
    "journal_id" uuid REFERENCES "journals"("id") ON DELETE SET NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "expense_lines" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "expense_id" uuid NOT NULL REFERENCES "expenses"("id") ON DELETE CASCADE,
    "gl_account_id" uuid NOT NULL REFERENCES "gl_accounts"("id"),
    "amount" numeric(12, 2) NOT NULL DEFAULT 0,
    "note" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "settings"
    ADD COLUMN IF NOT EXISTS "expense_prefix" text NOT NULL DEFAULT 'EXP';
