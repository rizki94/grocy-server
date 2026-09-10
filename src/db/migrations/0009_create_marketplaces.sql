CREATE TABLE IF NOT EXISTS "marketplaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL UNIQUE,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "marketplace_id" uuid REFERENCES "marketplaces"("id");
