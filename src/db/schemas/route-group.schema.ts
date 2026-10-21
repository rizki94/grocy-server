import {
    boolean,
    pgTable,
    text,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";
import { branches } from "./branch.schema";

export const routeGroups = pgTable("route_groups", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    branchId: uuid("branch_id").references(() => branches.id),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
        .defaultNow()
        .notNull()
        .$onUpdate(() => new Date()),
});
