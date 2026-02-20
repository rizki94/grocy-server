import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const permissionGroups = pgTable("permission_groups", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const permissions = pgTable("permissions", {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull().unique(),
    description: text("description"),
    groupId: uuid("group_id")
        .notNull()
        .references(() => permissionGroups.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});
