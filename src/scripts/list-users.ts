import { db } from "../db";
import { users, roles, permissions, rolePermissions } from "../db/schemas";
import { eq } from "drizzle-orm";

async function main() {
    const allRoles = await db.select().from(roles);
    console.log("Roles:", allRoles);

    const allPerms = await db.select().from(permissions);
    console.log("Permissions count:", allPerms.length);

    const allRolePerms = await db.select().from(rolePermissions);
    console.log("Role Permissions count:", allRolePerms.length);

    const rizkyUser = await db.select().from(users).where(eq(users.username, "rizky"));
    console.log("Rizky user:", rizkyUser);

    process.exit(0);
}

main().catch(console.error);
