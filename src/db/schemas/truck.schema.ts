import { decimalAsNumber } from "@/types/decimal-as-number";
import {
    boolean,
    pgTable,
    text,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";

export const trucks = pgTable("trucks", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    licensePlate: text("license_plate").notNull().unique(),
    maxWeight: decimalAsNumber(12, 2)("max_weight").notNull().default(0),
    maxVolume: decimalAsNumber(12, 3)("max_volume").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
        .defaultNow()
        .notNull()
        .$onUpdate(() => new Date()),
});
