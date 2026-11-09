ALTER TABLE "marketplaces" ADD COLUMN IF NOT EXISTS "price_group_id" uuid REFERENCES "price_groups"("id");

CREATE TABLE IF NOT EXISTS "marketplace_fee_rules" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "marketplace_id" uuid NOT NULL REFERENCES "marketplaces"("id") ON DELETE CASCADE,
    "name" text NOT NULL,
    "type" text NOT NULL DEFAULT 'percentage',
    "value" numeric(12, 2) NOT NULL DEFAULT 0,
    "category" text,
    "is_active" boolean NOT NULL DEFAULT true,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

