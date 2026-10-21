-- Extend settings table with sysadmin controls
ALTER TABLE "settings"
    ADD COLUMN IF NOT EXISTS "min_date_offset" integer NOT NULL DEFAULT -365,
    ADD COLUMN IF NOT EXISTS "max_date_offset" integer NOT NULL DEFAULT 30,
    ADD COLUMN IF NOT EXISTS "lock_sales_price" boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "enable_tax" boolean NOT NULL DEFAULT true;

-- Ensure global settings row exists
INSERT INTO "settings" ("id", "pos_round_2_digit", "allow_negative_stock", "enable_inventory_tracking", "min_date_offset", "max_date_offset", "lock_sales_price", "enable_tax")
VALUES ('global', false, false, true, -365, 30, false, true)
ON CONFLICT ("id") DO NOTHING;
