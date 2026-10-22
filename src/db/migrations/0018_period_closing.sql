-- 1. Ensure 3200 Laba Ditahan exists in gl_accounts if not exists
DO $$
DECLARE
    equity_parent_id uuid;
BEGIN
    SELECT id INTO equity_parent_id FROM "gl_accounts" WHERE code = '3000' LIMIT 1;

    IF NOT EXISTS (SELECT 1 FROM "gl_accounts" WHERE code = '3200') THEN
        INSERT INTO "gl_accounts" ("id", "code", "name", "type", "parent_id", "is_active", "created_at", "updated_at")
        VALUES (gen_random_uuid(), '3200', 'Laba Ditahan', 'equity', equity_parent_id, true, now(), now());
    END IF;
END $$;

-- 2. Add closing settings to settings table
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "closing_date" date;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "retained_earnings_gl_account_id" uuid REFERENCES "gl_accounts"("id");
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "closing_journal_prefix" text DEFAULT 'CLS' NOT NULL;

-- Automatically link retained_earnings_gl_account_id to 3200 if not set
UPDATE "settings"
SET "retained_earnings_gl_account_id" = (SELECT id FROM "gl_accounts" WHERE code = '3200' LIMIT 1)
WHERE "retained_earnings_gl_account_id" IS NULL;

-- 3. Create period_closings table
CREATE TABLE IF NOT EXISTS "period_closings" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "branch_id" uuid REFERENCES "branches"("id") ON DELETE SET NULL,
    "start_date" date NOT NULL,
    "end_date" date NOT NULL,
    "closing_journal_id" uuid REFERENCES "journals"("id") ON DELETE SET NULL,
    "total_income" numeric(12, 2) DEFAULT 0 NOT NULL,
    "total_expense" numeric(12, 2) DEFAULT 0 NOT NULL,
    "net_profit" numeric(12, 2) DEFAULT 0 NOT NULL,
    "status" text DEFAULT 'closed' NOT NULL,
    "notes" text,
    "closed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
    "closed_at" timestamp DEFAULT now() NOT NULL,
    "reopened_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
    "reopened_at" timestamp,
    "reopen_reason" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

-- 4. Seed closing permissions if permission_groups exists
DO $$
DECLARE
    accounting_group_id uuid;
    super_admin_role_id uuid;
    p_view_id uuid;
    p_create_id uuid;
    p_reopen_id uuid;
BEGIN
    SELECT id INTO accounting_group_id FROM "permission_groups" WHERE name = 'Accounting Management' LIMIT 1;
    SELECT id INTO super_admin_role_id FROM "roles" WHERE name = 'super_admin' LIMIT 1;

    IF accounting_group_id IS NOT NULL THEN
        -- accounting.closing.view
        IF NOT EXISTS (SELECT 1 FROM "permissions" WHERE code = 'accounting.closing.view') THEN
            INSERT INTO "permissions" ("id", "code", "description", "group_id", "created_at")
            VALUES (gen_random_uuid(), 'accounting.closing.view', 'View Period Closing', accounting_group_id, now())
            RETURNING id INTO p_view_id;
        ELSE
            SELECT id INTO p_view_id FROM "permissions" WHERE code = 'accounting.closing.view';
        END IF;

        -- accounting.closing.create
        IF NOT EXISTS (SELECT 1 FROM "permissions" WHERE code = 'accounting.closing.create') THEN
            INSERT INTO "permissions" ("id", "code", "description", "group_id", "created_at")
            VALUES (gen_random_uuid(), 'accounting.closing.create', 'Execute Period Closing', accounting_group_id, now())
            RETURNING id INTO p_create_id;
        ELSE
            SELECT id INTO p_create_id FROM "permissions" WHERE code = 'accounting.closing.create';
        END IF;

        -- accounting.closing.reopen
        IF NOT EXISTS (SELECT 1 FROM "permissions" WHERE code = 'accounting.closing.reopen') THEN
            INSERT INTO "permissions" ("id", "code", "description", "group_id", "created_at")
            VALUES (gen_random_uuid(), 'accounting.closing.reopen', 'Reopen Closed Period', accounting_group_id, now())
            RETURNING id INTO p_reopen_id;
        ELSE
            SELECT id INTO p_reopen_id FROM "permissions" WHERE code = 'accounting.closing.reopen';
        END IF;

        -- Grant to super_admin
        IF super_admin_role_id IS NOT NULL THEN
            IF p_view_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "role_permissions" WHERE role_id = super_admin_role_id AND permission_id = p_view_id) THEN
                INSERT INTO "role_permissions" ("id", "role_id", "permission_id") VALUES (gen_random_uuid(), super_admin_role_id, p_view_id);
            END IF;
            IF p_create_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "role_permissions" WHERE role_id = super_admin_role_id AND permission_id = p_create_id) THEN
                INSERT INTO "role_permissions" ("id", "role_id", "permission_id") VALUES (gen_random_uuid(), super_admin_role_id, p_create_id);
            END IF;
            IF p_reopen_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "role_permissions" WHERE role_id = super_admin_role_id AND permission_id = p_reopen_id) THEN
                INSERT INTO "role_permissions" ("id", "role_id", "permission_id") VALUES (gen_random_uuid(), super_admin_role_id, p_reopen_id);
            END IF;
        END IF;
    END IF;
END $$;
