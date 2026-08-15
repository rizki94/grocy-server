CREATE TABLE IF NOT EXISTS "route_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL UNIQUE,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "route_group_id" uuid REFERENCES "route_groups"("id");
