import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import { Client } from "pg";
import { getTenantDb, syncTenantPermissions, ensureEssentialTenantData } from "../services/tenant.service";
import * as schema from "../db/schemas";
import { eq } from "drizzle-orm";

async function main() {
    const defaultUrl = process.env.DB_URL || process.env.DATABASE_URL || "";
    const client = new Client({ connectionString: defaultUrl });
    await client.connect();

    const dbsRes = await client.query("SELECT datname FROM pg_database WHERE datistemplate = false;");
    const dbs = dbsRes.rows.map((r: any) => r.datname);
    console.log("Databases in Postgres:", dbs);

    for (const dbName of dbs) {
        if (dbName === "postgres" || dbName === "evolution_db") continue;
        console.log(`\n========================================`);
        console.log(`Syncing permissions for database: ${dbName}`);
        console.log(`========================================`);

        try {
            const tenantDb = getTenantDb(dbName);
            await syncTenantPermissions(tenantDb);
            await ensureEssentialTenantData(tenantDb);

            // Also check users with username 'admin' or 'super_admin' and ensure roleId points to super_admin role
            const [superAdminRole] = await tenantDb
                .select()
                .from(schema.roles)
                .where(eq(schema.roles.name, "super_admin"))
                .limit(1);

            if (superAdminRole) {
                const candidates = ["admin", "super_admin", "rizky"];
                for (const uName of candidates) {
                    const [u] = await tenantDb
                        .select()
                        .from(schema.users)
                        .where(eq(schema.users.username, uName))
                        .limit(1);

                    if (u) {
                        await tenantDb
                            .update(schema.users)
                            .set({
                                roleId: superAdminRole.id,
                                isActive: true,
                            })
                            .where(eq(schema.users.id, u.id));
                        console.log(`Ensured user '${uName}' has role 'super_admin' (${superAdminRole.id})`);
                    }
                }
            }

            const permsCount = await tenantDb.select().from(schema.permissions);
            const rolePermsCount = await tenantDb
                .select()
                .from(schema.rolePermissions)
                .where(eq(schema.rolePermissions.roleId, superAdminRole?.id || ""));

            console.log(`DB [${dbName}] -> Total permissions: ${permsCount.length}, Super Admin permissions: ${rolePermsCount.length}`);
        } catch (err: any) {
            console.error(`Failed to sync permissions for ${dbName}:`, err.message);
        }
    }

    await client.end();
    console.log("\nAll tenant database permissions synced successfully!");
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
