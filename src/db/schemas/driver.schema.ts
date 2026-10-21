import {
    boolean,
    pgTable,
    text,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";
import { trucks } from "./truck.schema";
import { branches } from "./branch.schema";

export const drivers = pgTable("drivers", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    branchId: uuid("branch_id").references(() => branches.id),
    color: text("color").notNull().default("#3B82F6"),
    defaultTruckId: uuid("default_truck_id").references(() => trucks.id),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
        .defaultNow()
        .notNull()
        .$onUpdate(() => new Date()),
});
