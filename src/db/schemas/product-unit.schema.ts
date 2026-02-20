import {
    pgTable,
    text,
    timestamp,
    unique,
    uuid,
    varchar,
} from "drizzle-orm/pg-core";

export const productUnits = pgTable(
    "product_units",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        abbreviation: varchar("abbreviation").notNull().unique(),
        name: text("name").notNull().unique(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [unique().on(table.name, table.abbreviation)],
);
