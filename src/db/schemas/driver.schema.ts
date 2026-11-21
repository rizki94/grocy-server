import {
    boolean,
    pgTable,
    text,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";
import { trucks } from "./truck.schema";
import { branches } from "./branch.schema";
import { employees } from "./hrd.schema";
import { relations } from "drizzle-orm";

export const drivers = pgTable("drivers", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    employeeId: uuid("employee_id").references(() => employees.id),
    branchId: uuid("branch_id")
        .notNull()
        .references(() => branches.id),
    color: text("color").notNull().default("#3B82F6"),
    defaultTruckId: uuid("default_truck_id").references(() => trucks.id),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
        .defaultNow()
        .notNull()
        .$onUpdate(() => new Date()),
});

export const driversRelations = relations(drivers, ({ one }) => ({
    branch: one(branches, {
        fields: [drivers.branchId],
        references: [branches.id],
    }),
    truck: one(trucks, {
        fields: [drivers.defaultTruckId],
        references: [trucks.id],
    }),
    employee: one(employees, {
        fields: [drivers.employeeId],
        references: [employees.id],
    }),
}));
