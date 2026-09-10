import { db } from "./index";
import { sql } from "drizzle-orm";
import { readFileSync } from "fs";
import { join } from "path";

async function runMigration() {
    try {
        const migrationPath = join(
            __dirname,
            "migrations",
            "0005_safe_simplify_schema.sql",
        );
        const migration = readFileSync(migrationPath, "utf-8");

        console.log("Applying migration...");
        await db.execute(sql.raw(migration));
        console.log("✅ Migration applied successfully!");
        process.exit(0);
    } catch (error) {
        console.error("❌ Migration failed:", error);
        process.exit(1);
    }
}

runMigration();
