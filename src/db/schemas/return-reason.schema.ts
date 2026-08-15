import { pgTable, text, boolean, timestamp, uuid } from "drizzle-orm/pg-core";

export const returnReasons = pgTable("return_reasons", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    code: text("code"),
    type: text("type", { enum: ["sales_return", "purchase_return", "all"] })
        .notNull()
        .default("all"),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
        .defaultNow()
        .notNull()
        .$onUpdate(() => new Date()),
});
