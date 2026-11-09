import { db } from "@/db";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";

async function main() {
    console.log("Running migration 0028: Creating product_tier_prices table...");
    const migrationPath = path.join(__dirname, "../db/migrations/0028_create_product_tier_prices.sql");
    const migrationSql = fs.readFileSync(migrationPath, "utf-8");

    await db.execute(sql.raw(migrationSql));
    console.log("Successfully executed migration 0028!");
    process.exit(0);
}

main().catch((err) => {
    console.error("Migration 0028 failed:", err);
    process.exit(1);
});

