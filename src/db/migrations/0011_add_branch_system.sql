-- 1. Create branches table
CREATE TABLE IF NOT EXISTS "branches" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "code" text NOT NULL UNIQUE,
    "name" text NOT NULL,
    "address" text,
    "phone" text,
    "is_hq" boolean NOT NULL DEFAULT false,
    "is_active" boolean NOT NULL DEFAULT true,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

-- 2. Insert Default HQ Branch
INSERT INTO "branches" ("id", "code", "name", "is_hq", "is_active")
SELECT gen_random_uuid(), 'HQ', 'Headquarters', true, true
WHERE NOT EXISTS (SELECT 1 FROM "branches" WHERE "code" = 'HQ');

-- 3. Add branch_id to existing tables and backfill with HQ
DO $$
DECLARE
    hq_id uuid;
BEGIN
    SELECT "id" INTO hq_id FROM "branches" WHERE "code" = 'HQ' LIMIT 1;

    -- USERS
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'branch_id') THEN
        ALTER TABLE "users" ADD COLUMN "branch_id" uuid REFERENCES "branches"("id");
    END IF;
    UPDATE "users" SET "branch_id" = hq_id WHERE "branch_id" IS NULL;

    -- WAREHOUSES
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'warehouses' AND column_name = 'branch_id') THEN
        ALTER TABLE "warehouses" ADD COLUMN "branch_id" uuid REFERENCES "branches"("id");
    END IF;
    UPDATE "warehouses" SET "branch_id" = hq_id WHERE "branch_id" IS NULL;
    ALTER TABLE "warehouses" ALTER COLUMN "branch_id" SET NOT NULL;

    -- TRANSACTIONS
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'branch_id') THEN
        ALTER TABLE "transactions" ADD COLUMN "branch_id" uuid REFERENCES "branches"("id");
    END IF;
    UPDATE "transactions" SET "branch_id" = hq_id WHERE "branch_id" IS NULL;
    ALTER TABLE "transactions" ALTER COLUMN "branch_id" SET NOT NULL;

    -- PAYMENTS
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'payments' AND column_name = 'branch_id') THEN
        ALTER TABLE "payments" ADD COLUMN "branch_id" uuid REFERENCES "branches"("id");
    END IF;
    UPDATE "payments" SET "branch_id" = hq_id WHERE "branch_id" IS NULL;
    ALTER TABLE "payments" ALTER COLUMN "branch_id" SET NOT NULL;

    -- OPEN INVOICES
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'open_invoices' AND column_name = 'branch_id') THEN
        ALTER TABLE "open_invoices" ADD COLUMN "branch_id" uuid REFERENCES "branches"("id");
    END IF;
    UPDATE "open_invoices" SET "branch_id" = hq_id WHERE "branch_id" IS NULL;
    ALTER TABLE "open_invoices" ALTER COLUMN "branch_id" SET NOT NULL;

    -- JOURNALS
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'journals' AND column_name = 'branch_id') THEN
        ALTER TABLE "journals" ADD COLUMN "branch_id" uuid REFERENCES "branches"("id");
    END IF;
    UPDATE "journals" SET "branch_id" = hq_id WHERE "branch_id" IS NULL;
    ALTER TABLE "journals" ALTER COLUMN "branch_id" SET NOT NULL;

    -- DELIVERIES
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'deliveries' AND column_name = 'branch_id') THEN
        ALTER TABLE "deliveries" ADD COLUMN "branch_id" uuid REFERENCES "branches"("id");
    END IF;
    UPDATE "deliveries" SET "branch_id" = hq_id WHERE "branch_id" IS NULL;
    ALTER TABLE "deliveries" ALTER COLUMN "branch_id" SET NOT NULL;

    -- DRIVERS
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'drivers' AND column_name = 'branch_id') THEN
        ALTER TABLE "drivers" ADD COLUMN "branch_id" uuid REFERENCES "branches"("id");
    END IF;
    UPDATE "drivers" SET "branch_id" = hq_id WHERE "branch_id" IS NULL;
    ALTER TABLE "drivers" ALTER COLUMN "branch_id" SET NOT NULL;

    -- TRUCKS
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trucks' AND column_name = 'branch_id') THEN
        ALTER TABLE "trucks" ADD COLUMN "branch_id" uuid REFERENCES "branches"("id");
    END IF;
    UPDATE "trucks" SET "branch_id" = hq_id WHERE "branch_id" IS NULL;
    ALTER TABLE "trucks" ALTER COLUMN "branch_id" SET NOT NULL;

    -- POS SESSIONS
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pos_sessions' AND column_name = 'branch_id') THEN
        ALTER TABLE "pos_sessions" ADD COLUMN "branch_id" uuid REFERENCES "branches"("id");
    END IF;
    UPDATE "pos_sessions" SET "branch_id" = hq_id WHERE "branch_id" IS NULL;

    -- ROUTE GROUPS
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'route_groups' AND column_name = 'branch_id') THEN
        ALTER TABLE "route_groups" ADD COLUMN "branch_id" uuid REFERENCES "branches"("id");
    END IF;
    UPDATE "route_groups" SET "branch_id" = hq_id WHERE "branch_id" IS NULL;

    -- PRODUCTS: is_global
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'is_global') THEN
        ALTER TABLE "products" ADD COLUMN "is_global" boolean NOT NULL DEFAULT true;
    END IF;

    -- PRODUCT DETAIL PRICES: branch_id
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'product_detail_prices' AND column_name = 'branch_id') THEN
        ALTER TABLE "product_detail_prices" ADD COLUMN "branch_id" uuid REFERENCES "branches"("id") ON DELETE CASCADE;
    END IF;

END $$;

-- 4. Create product_branches table
CREATE TABLE IF NOT EXISTS "product_branches" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
    "branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE CASCADE,
    "created_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "product_branches_product_id_branch_id_unique" UNIQUE ("product_id", "branch_id")
);
