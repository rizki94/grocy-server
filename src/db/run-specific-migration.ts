import { db } from "./index";
import { sql } from "drizzle-orm";
import { readFileSync } from "fs";
import { join } from "path";

async function runMigration() {
    const fileName = process.argv[2];
    if (!fileName) {
        console.error("Please provide a migration file name.");
        process.exit(1);
    }

    try {
        const migrationPath = join(__dirname, "migrations", fileName);
        const migration = readFileSync(migrationPath, "utf-8");

        console.log(`Applying migration ${fileName}...`);
        await db.execute(sql.raw(migration));
        console.log("✅ Migration applied successfully!");
        process.exit(0);
    } catch (error) {
        console.error("❌ Migration failed:", error);
        process.exit(1);
    }
}

runMigration();
