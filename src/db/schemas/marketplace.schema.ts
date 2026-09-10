import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { contacts } from "./contact.schema";
import { relations } from "drizzle-orm";

export const marketplaces = pgTable("marketplaces", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    code: text("code").notNull().unique(),
    contactId: uuid("contact_id").references(() => contacts.id),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
        .defaultNow()
        .notNull()
        .$onUpdate(() => new Date()),
});

export const marketplacesRelations = relations(marketplaces, ({ one }) => ({
    contact: one(contacts, {
        fields: [marketplaces.contactId],
        references: [contacts.id],
    }),
}));
