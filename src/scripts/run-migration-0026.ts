import { db } from "@/db";
import { sql } from "drizzle-orm";

async function run() {
    console.log("Adding category_attribute_id to marketplaces...");
    await db.execute(sql`
        ALTER TABLE "marketplaces" ADD COLUMN IF NOT EXISTS "category_attribute_id" uuid REFERENCES "product_attributes"("id");
    `);
    console.log("Successfully added category_attribute_id to marketplaces!");
    process.exit(0);
}

run().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
});

