import {
    boolean,
    pgTable,
    text,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";

export const warehouses = pgTable("warehouses", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull().unique(),
    address: text("address"),
    phone: text("phone"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
        .defaultNow()
        .notNull()
        .$onUpdate(() => new Date()),
});
