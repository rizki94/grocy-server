import { db } from "@/db";
import { sql } from "drizzle-orm";

async function run() {
    console.log("Running migration 0025...");
    await db.execute(sql`
        ALTER TABLE "marketplaces" ADD COLUMN IF NOT EXISTS "price_group_id" uuid REFERENCES "price_groups"("id");
    `);
    console.log("Added price_group_id to marketplaces.");

    await db.execute(sql`
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
    `);
    console.log("Created marketplace_fee_rules table.");
    process.exit(0);
}

run().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
});

