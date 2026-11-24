import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import { db } from "../db";
import { roles, permissions, permissionGroups, rolePermissions, users } from "../db/schemas";
import { eq, and } from "drizzle-orm";
import { PERMISSION_GROUPS, ALL_PERMISSIONS, CASHIER_PERMISSION_CODES } from "../constants/permissions.constant";

async function main() {
    console.log("Seeding permissions and assigning to super_admin...");

    // Helper to get or create
    async function getOrCreate<T>(
        table: any,
        check: any,
        values: any,
    ): Promise<T> {
        const [existing] = await db
            .select()
            .from(table)
            .where(check)
            .limit(1);
        if (existing) return existing as T;
        const [inserted] = (await db
            .insert(table)
            .values(values)
            .returning()) as any[];
        return inserted as T;
    }

    // 1. Ensure standard roles exist
    const standardRoles = ["super_admin", "admin", "cashier", "warehouse", "accountant", "user"];
    const rolesMap: Record<string, typeof roles.$inferSelect> = {};

    for (const roleName of standardRoles) {
        rolesMap[roleName] = await getOrCreate<typeof roles.$inferSelect>(
            roles,
            eq(roles.name, roleName),
            { name: roleName },
        );
    }
    const superAdminRole = rolesMap["super_admin"];
    console.log(`Roles ensured: ${Object.keys(rolesMap).join(", ")}`);

    // 2. Permission Groups
    const permissionGroupsMap: Record<string, string> = {};

    for (const g of PERMISSION_GROUPS) {
        const group = await getOrCreate<typeof permissionGroups.$inferSelect>(
            permissionGroups,
            eq(permissionGroups.name, g.name),
            { name: g.name },
        );
        permissionGroupsMap[g.code] = group.id;
    }

    // 3. Permissions List
    const insertedPermissions: (typeof permissions.$inferSelect)[] = [];
    for (const p of ALL_PERMISSIONS) {
        const perm = await getOrCreate<typeof permissions.$inferSelect>(
            permissions,
            eq(permissions.code, p.code),
            {
                code: p.code,
                description: p.description,
                groupId: permissionGroupsMap[p.group],
            },
        );
        insertedPermissions.push(perm);
    }
    console.log(`Total permissions seeded: ${insertedPermissions.length}`);

    // 4. Assign ALL permissions to super_admin
    let assignedCount = 0;
    for (const p of insertedPermissions) {
        await getOrCreate(
            rolePermissions,
            and(
                eq(rolePermissions.roleId, superAdminRole.id),
                eq(rolePermissions.permissionId, p.id),
            ),
            {
                roleId: superAdminRole.id,
                permissionId: p.id,
                hasPermission: true,
            },
        );
        assignedCount++;
    }
    console.log(`Assigned ${assignedCount} permissions to super_admin`);

    // 4b. Assign CASHIER permissions to role 'cashier'
    const cashierRole = rolesMap["cashier"];
    if (cashierRole) {
        let cashierAssignedCount = 0;
        for (const code of CASHIER_PERMISSION_CODES) {
            const p = insertedPermissions.find((perm) => perm.code === code);
            if (p) {
                await getOrCreate(
                    rolePermissions,
                    and(
                        eq(rolePermissions.roleId, cashierRole.id),
                        eq(rolePermissions.permissionId, p.id),
                    ),
                    {
                        roleId: cashierRole.id,
                        permissionId: p.id,
                        hasPermission: true,
                    },
                );
                cashierAssignedCount++;
            }
        }
        console.log(`Assigned ${cashierAssignedCount} permissions to cashier role`);
    }

    // 5. Ensure any user with username 'admin' or 'super_admin' or 'rizky' has roleId set to super_admin if not set
    const candidates = ["admin", "super_admin", "rizky"];
    for (const uName of candidates) {
        const [u] = await db
            .select()
            .from(users)
            .where(eq(users.username, uName))
            .limit(1);

        if (u) {
            await db
                .update(users)
                .set({
                    roleId: superAdminRole.id,
                    isActive: true,
                })
                .where(eq(users.id, u.id));
            console.log(`User '${uName}' assigned super_admin role successfully.`);
        }
    }

    console.log("Done!");
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
