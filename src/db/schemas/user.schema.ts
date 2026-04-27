import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { roles } from "./role.schema";
import { glAccounts } from "./gl-account.schema";
import { warehouses } from "./warehouse.schema";

export const users = pgTable("users", {
    id: uuid("id").defaultRandom().primaryKey(),
    username: text("username").notNull().unique(),
    password: text("password").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    roleId: uuid("role_id")
        .notNull()
        .references(() => roles.id),
    cashGlAccountId: uuid("cash_gl_account_id").references(() => glAccounts.id),
    posWarehouseId: uuid("pos_warehouse_id").references(() => warehouses.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ one }) => ({}));
