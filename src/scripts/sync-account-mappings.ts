import { db } from "@/db";
import { sql } from "drizzle-orm";
import { getTenantDb } from "@/services/tenant.service";
import { syncDbAccountMappings } from "@/helpers/account-mapping-sync.helper";

async function run() {
    console.log("=== Syncing Account Mappings Across All Databases ===");
    const dbsRes = await db.execute(sql`SELECT datname FROM pg_database WHERE datistemplate = false;`);
    const dbNames = dbsRes.rows
        .map((r: any) => r.datname)
        .filter((name: string) => !['postgres', 'nutrition_calc_db', 'nutri_calc_db', 'evolution_db'].includes(name));

    console.log("Target databases:", dbNames);

    for (const name of dbNames) {
        console.log(`\nSyncing settings mappings for: ${name}...`);
        try {
            const tdb = getTenantDb(name);
            const res = await syncDbAccountMappings(tdb);
            console.log(`✓ Mappings synced for ${name}: AR=${res?.arGlAccountId ? "OK" : "NONE"}, AP=${res?.apGlAccountId ? "OK" : "NONE"}, Sales=${res?.salesRevenueGlAccountId ? "OK" : "NONE"}`);
        } catch (e: any) {
            console.error(`✗ Error syncing ${name}:`, e.message);
        }
    }

    console.log("\nAll databases synced successfully!");
    process.exit(0);
}

run().catch((e) => {
    console.error("Sync failed:", e);
    process.exit(1);
});
