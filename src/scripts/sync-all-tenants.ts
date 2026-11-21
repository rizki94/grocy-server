import "dotenv/config";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { getTenantDb } from "../services/tenant.service";
import { roles, permissions, permissionGroups, rolePermissions, users } from "../db/schemas";
import { PERMISSION_GROUPS, ALL_PERMISSIONS } from "../constants/permissions.constant";
import { eq, and } from "drizzle-orm";
import fs from "fs";
import path from "path";

// List of system or non-tenant databases to ignore
const EXCLUDED_DATABASES = [
    "postgres",
    "template0",
    "template1",
    "nutrition_calc_db",
    "nutri_calc_db",
    "evolution_db",
];

async function main() {
    console.log("======================================================");
    console.log("🚀 MULTI-TENANT DATABASE SYNC (SCHEMA & PERMISSIONS)");
    console.log("======================================================");

    // 1. Fetch all databases in PostgreSQL
    const dbsRes = await db.execute(sql`
        SELECT datname FROM pg_database 
        WHERE datistemplate = false 
        ORDER BY datname;
    `);

    const targetDbs = dbsRes.rows
        .map((r: any) => r.datname)
        .filter((name: string) => !EXCLUDED_DATABASES.includes(name));

    console.log(`Found ${targetDbs.length} active tenant database(s):`, targetDbs);

    // Read all migration files from src/db/migrations
    const migrationsDir = path.resolve(__dirname, "../db/migrations");
    const fixSqlPath = path.resolve(__dirname, "../db/fix_restore_missing_tables.sql");
    const fixSql = fs.existsSync(fixSqlPath) ? fs.readFileSync(fixSqlPath, "utf-8") : "";

    // Exclude obsolete legacy files that drop tables
    const EXCLUDED_MIGRATION_FILES = [
        "0004_simplify_transaction_schema.sql",
        "0005_safe_simplify_schema.sql",
        "0005_steady_franklin_storm.sql",
    ];

    const migrationFiles = fs.readdirSync(migrationsDir)
        .filter((file) => file.endsWith(".sql") && !EXCLUDED_MIGRATION_FILES.includes(file))
        .sort(); // 0000, 0001, ..., 0032

    console.log(`Found ${migrationFiles.length} migration file(s) available.`);

    const results: Array<{
        database: string;
        migrationsStatus: string;
        permissionsCount: number;
        status: "SUCCESS" | "FAILED";
        error?: string;
    }> = [];

    // Helper to get or create
    async function getOrCreate<T>(
        tdb: any,
        table: any,
        check: any,
        values: any,
    ): Promise<T> {
        const [existing] = await tdb
            .select()
            .from(table)
            .where(check)
            .limit(1);
        if (existing) return existing as T;
        const [inserted] = (await tdb
            .insert(table)
            .values(values)
            .returning()) as any[];
        return inserted as T;
    }

    for (const dbName of targetDbs) {
        console.log(`\n------------------------------------------------------`);
        console.log(`📦 Processing database: [${dbName}]`);
        console.log(`------------------------------------------------------`);

        try {
            const tdb = getTenantDb(dbName);

            // 1. Ensure core schema baseline & required columns exist
            if (fixSql) {
                try {
                    await tdb.execute(sql.raw(fixSql));
                } catch (fErr: any) {
                    console.warn(`  ⚠️ Core schema check warning:`, fErr.message);
                }
            }

            // 2. Apply all migration scripts (split by statement-breakpoint for granular execution)
            let appliedMigrations = 0;
            for (const file of migrationFiles) {
                const filePath = path.join(migrationsDir, file);
                const fileSql = fs.readFileSync(filePath, "utf-8");

                const statements = fileSql
                    .split("--> statement-breakpoint")
                    .map((s) => s.trim())
                    .filter((s) => s.length > 0);

                let fileHasError = false;
                for (const stmt of statements) {
                    try {
                        await tdb.execute(sql.raw(stmt));
                    } catch (mErr: any) {
                        const isAlreadyApplied =
                            mErr.message?.includes("already exists") ||
                            mErr.message?.includes("duplicate") ||
                            mErr.message?.includes("multiple primary keys") ||
                            mErr.message?.includes("already a partition") ||
                            mErr.message?.includes("tidak ada") && mErr.message?.includes("DROP");
                        if (!isAlreadyApplied) {
                            fileHasError = true;
                        }
                    }
                }
                if (!fileHasError) {
                    appliedMigrations++;
                }
            }
            console.log(`  ✓ Schema migrations checked & applied.`);

            // 2. Ensure standard roles exist
            const standardRoles = ["super_admin", "admin", "cashier", "warehouse", "accountant", "user"];
            const rolesMap: Record<string, any> = {};

            for (const roleName of standardRoles) {
                rolesMap[roleName] = await getOrCreate(
                    tdb,
                    roles,
                    eq(roles.name, roleName),
                    { name: roleName },
                );
            }
            const superAdminRole = rolesMap["super_admin"];

            // 3. Ensure permission groups exist
            const permissionGroupsMap: Record<string, string> = {};
            for (const g of PERMISSION_GROUPS) {
                const group = await getOrCreate<any>(
                    tdb,
                    permissionGroups,
                    eq(permissionGroups.name, g.name),
                    { name: g.name },
                );
                permissionGroupsMap[g.code] = group.id;
            }

            // 4. Ensure all permissions exist
            const permissionsMap: Record<string, string> = {};
            for (const p of ALL_PERMISSIONS) {
                const groupId = permissionGroupsMap[p.group];
                if (!groupId) continue;

                const perm = await getOrCreate<any>(
                    tdb,
                    permissions,
                    eq(permissions.code, p.code),
                    {
                        code: p.code,
                        description: p.description,
                        groupId,
                    },
                );
                permissionsMap[p.code] = perm.id;
            }

            // 5. Assign all permissions to super_admin
            if (superAdminRole) {
                for (const permId of Object.values(permissionsMap)) {
                    const [existingRp] = await tdb
                        .select()
                        .from(rolePermissions)
                        .where(
                            and(
                                eq(rolePermissions.roleId, superAdminRole.id),
                                eq(rolePermissions.permissionId, permId),
                            ),
                        )
                        .limit(1);

                    if (!existingRp) {
                        await tdb.insert(rolePermissions).values({
                            roleId: superAdminRole.id,
                            permissionId: permId,
                        });
                    }
                }
            }

            // 6. Ensure super_admin role is assigned to admin users
            const adminUsers = await tdb
                .select({ id: users.id })
                .from(users)
                .where(
                    sql`${users.username} IN ('admin', 'super_admin') AND ${users.roleId} != ${superAdminRole.id}`,
                );

            for (const u of adminUsers) {
                await tdb
                    .update(users)
                    .set({ roleId: superAdminRole.id })
                    .where(eq(users.id, u.id));
            }

            const totalPerms = Object.keys(permissionsMap).length;
            console.log(`  ✓ Synced ${totalPerms} permissions for [${dbName}].`);

            results.push({
                database: dbName,
                migrationsStatus: `${migrationFiles.length} migrations OK`,
                permissionsCount: totalPerms,
                status: "SUCCESS",
            });
        } catch (err: any) {
            console.error(`  ✗ Error syncing database [${dbName}]:`, err.message);
            results.push({
                database: dbName,
                migrationsStatus: "Failed",
                permissionsCount: 0,
                status: "FAILED",
                error: err.message,
            });
        }
    }

    console.log(`\n======================================================`);
    console.log("📊 MULTI-TENANT SYNC SUMMARY");
    console.log("======================================================");
    console.table(results);

    process.exit(0);
}

main().catch((e) => {
    console.error("Fatal error during multi-tenant sync:", e);
    process.exit(1);
});
