import { db } from "../db";
import { sql } from "drizzle-orm";
import { getTenantDb } from "../services/tenant.service";
import fs from "fs";
import path from "path";

async function run() {
    console.log("=== Syncing Migrations to All Databases ===");
    const dbsRes = await db.execute(sql`SELECT datname FROM pg_database WHERE datistemplate = false;`);
    const dbNames = dbsRes.rows
        .map((r: any) => r.datname)
        .filter((name: string) => !['postgres', 'nutrition_calc_db', 'nutri_calc_db', 'evolution_db'].includes(name));

    console.log("Target databases:", dbNames);

    const migration0032Path = path.resolve(__dirname, "../db/migrations/0032_integrate_employee_driver_transactions.sql");
    const migration0032Sql = fs.readFileSync(migration0032Path, "utf-8");

    for (const name of dbNames) {
        console.log(`\nApplying migration 0032 to: ${name}...`);
        try {
            const tdb = getTenantDb(name);
            await tdb.execute(sql.raw(migration0032Sql));
            console.log(`✓ Migration 0032 applied successfully to ${name}`);
        } catch (e: any) {
            console.error(`✗ Error applying to ${name}:`, e.message);
        }
    }

    console.log("\nAll databases migrated successfully!");
    process.exit(0);
}

run().catch((e) => {
    console.error("Migration sync failed:", e);
    process.exit(1);
});
