DO $$ BEGIN
    CREATE TYPE "stock_opname_status" AS ENUM('draft', 'in_progress', 'completed', 'cancelled');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "stock_opnames" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "code" text NOT NULL UNIQUE,
    "name" text NOT NULL,
    "branch_id" uuid REFERENCES "branches"("id"),
    "warehouse_id" uuid REFERENCES "warehouses"("id"),
    "count_date" date NOT NULL,
    "status" "stock_opname_status" NOT NULL DEFAULT 'draft',
    "note" text,
    "adjustment_transaction_id" uuid REFERENCES "transactions"("id"),
    "created_by" uuid NOT NULL REFERENCES "users"("id"),
    "completed_by" uuid REFERENCES "users"("id"),
    "completed_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "stock_opname_items" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "stock_opname_id" uuid NOT NULL REFERENCES "stock_opnames"("id") ON DELETE CASCADE,
    "product_id" uuid NOT NULL REFERENCES "products"("id"),
    "product_detail_id" uuid NOT NULL REFERENCES "product_details"("id"),
    "warehouse_id" uuid REFERENCES "warehouses"("id"),
    "batch_number" text,
    "expiry_date" date,
    "system_qty" numeric(12, 2) NOT NULL DEFAULT 0,
    "physical_qty" numeric(12, 2),
    "difference" numeric(12, 2),
    "unit_cost" numeric(12, 2) NOT NULL DEFAULT 0,
    "note" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);
