import { boolean, pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { roles } from "./role.schema";
import { permissions } from "./permission.schema";

export const rolePermissions = pgTable(
    "role_permissions",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        roleId: uuid("role_id")
            .notNull()
            .references(() => roles.id),
        permissionId: uuid("permission_id")
            .notNull()
            .references(() => permissions.id),
        hasPermission: boolean("has_permission").notNull().default(true),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [unique().on(table.roleId, table.permissionId)]
);
