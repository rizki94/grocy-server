CREATE TABLE IF NOT EXISTS "product_tier_prices" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "product_detail_id" uuid NOT NULL REFERENCES "product_details"("id") ON DELETE CASCADE,
    "price_group_id" uuid REFERENCES "price_groups"("id") ON DELETE CASCADE,
    "branch_id" uuid REFERENCES "branches"("id") ON DELETE CASCADE,
    "min_qty" integer NOT NULL,
    "price" numeric(12, 2) NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_product_tier_prices_detail_id" ON "product_tier_prices" ("product_detail_id");

