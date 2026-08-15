import {
    date,
    integer,
    pgEnum,
    pgTable,
    text,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";
import { drivers } from "./driver.schema";
import { trucks } from "./truck.schema";
import { transactions } from "./transaction.schema";

export const deliveryStatusEnum = pgEnum("delivery_status", [
    "draft",
    "dispatched",
    "completed",
    "cancelled",
]);

export const deliveries = pgTable("deliveries", {
    id: uuid("id").defaultRandom().primaryKey(),
    loadNumber: text("load_number"),
    deliveryDate: date("delivery_date").notNull(),
    driverId: uuid("driver_id")
        .notNull()
        .references(() => drivers.id),
    truckId: uuid("truck_id")
        .notNull()
        .references(() => trucks.id),
    status: deliveryStatusEnum("status").notNull().default("draft"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
        .defaultNow()
        .notNull()
        .$onUpdate(() => new Date()),
});

export const deliveryItems = pgTable("delivery_items", {
    id: uuid("id").defaultRandom().primaryKey(),
    deliveryId: uuid("delivery_id")
        .notNull()
        .references(() => deliveries.id, { onDelete: "cascade" }),
    transactionId: uuid("transaction_id")
        .notNull()
        .references(() => transactions.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});
