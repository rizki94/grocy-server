DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'conversation_type') THEN
    CREATE TYPE "public"."conversation_type" AS ENUM('private', 'group');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'message_type') THEN
    CREATE TYPE "public"."message_type" AS ENUM('text', 'image', 'video', 'audio', 'document', 'event_share');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pos_session_status') THEN
    CREATE TYPE "public"."pos_session_status" AS ENUM('open', 'closed');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "price_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "price_groups_name_unique" UNIQUE("name")
);

CREATE TABLE IF NOT EXISTS "product_detail_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_detail_id" uuid NOT NULL,
	"price_group_id" uuid NOT NULL,
	"price" numeric(12,2) DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "product_detail_prices_product_detail_id_price_group_id_unique" UNIQUE("product_detail_id","price_group_id")
);

CREATE TABLE IF NOT EXISTS "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "conversation_type" NOT NULL,
	"name" text,
	"avatar" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "conversation_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"last_read_at" timestamp
);

CREATE TABLE IF NOT EXISTS "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"type" "message_type" DEFAULT 'text' NOT NULL,
	"content" text,
	"media_url" text,
	"media_type" text,
	"media_size" integer,
	"media_name" text,
	"event_type" text,
	"event_id" uuid,
	"reply_to_id" uuid,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "message_reads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"read_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"data" jsonb,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp,
	"actor_id" uuid,
	"entity_type" text,
	"entity_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);

-- Ensure missing columns on existing tables
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "price_group_id" uuid;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "use_batch" boolean DEFAULT false NOT NULL;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "use_expiry" boolean DEFAULT false NOT NULL;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "use_serial_number" boolean DEFAULT false NOT NULL;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "reorder_level" numeric(12,2) DEFAULT 0 NOT NULL;
ALTER TABLE "transaction_details" ADD COLUMN IF NOT EXISTS "warehouse_id" uuid;
ALTER TABLE "transaction_details" ADD COLUMN IF NOT EXISTS "batch_number" text;
ALTER TABLE "transaction_details" ADD COLUMN IF NOT EXISTS "expiry_date" date;
ALTER TABLE "transaction_details" ADD COLUMN IF NOT EXISTS "serial_numbers" text[];
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "pos_session_id" uuid;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "cash_gl_account_id" uuid;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pos_warehouse_id" uuid;
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "batch_number" text;
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "expiry_date" date;
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "serial_number" text;
ALTER TABLE "stocks" ADD COLUMN IF NOT EXISTS "warehouse_id" uuid;
ALTER TABLE "stocks" ADD COLUMN IF NOT EXISTS "batch_number" text;
ALTER TABLE "stocks" ADD COLUMN IF NOT EXISTS "expiry_date" date;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "reference" text;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "note" text;

-- Ensure foreign keys exist
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_price_group_id_price_groups_id_fk') THEN
    ALTER TABLE "contacts" ADD CONSTRAINT "contacts_price_group_id_price_groups_id_fk" FOREIGN KEY ("price_group_id") REFERENCES "public"."price_groups"("id") ON DELETE no action ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_detail_prices_price_group_id_price_groups_id_fk') THEN
    ALTER TABLE "product_detail_prices" ADD CONSTRAINT "product_detail_prices_price_group_id_price_groups_id_fk" FOREIGN KEY ("price_group_id") REFERENCES "public"."price_groups"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_tier_prices_price_group_id_price_groups_id_fk') THEN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'product_tier_prices') THEN
      ALTER TABLE "product_tier_prices" ADD CONSTRAINT "product_tier_prices_price_group_id_price_groups_id_fk" FOREIGN KEY ("price_group_id") REFERENCES "public"."price_groups"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketplaces_price_group_id_price_groups_id_fk') THEN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'marketplaces') THEN
      ALTER TABLE "marketplaces" ADD CONSTRAINT "marketplaces_price_group_id_price_groups_id_fk" FOREIGN KEY ("price_group_id") REFERENCES "public"."price_groups"("id") ON DELETE no action ON UPDATE no action;
    END IF;
  END IF;
END $$;

-- Insert default price group if none exists
INSERT INTO "price_groups" ("id", "name", "description", "is_active")
SELECT gen_random_uuid(), 'General', 'Default Price Group', true
WHERE NOT EXISTS (SELECT 1 FROM "price_groups");
