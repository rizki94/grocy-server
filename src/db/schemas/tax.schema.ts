import { pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const taxes = pgTable("taxes", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull().unique(),
    rate: smallint("rate").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});
