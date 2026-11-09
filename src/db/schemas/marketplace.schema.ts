import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { contacts } from "./contact.schema";
import { priceGroups } from "./price-group.schema";
import { productAttributes } from "./product-attribute.schema";
import { decimalAsNumber } from "@/types/decimal-as-number";
import { relations } from "drizzle-orm";

export const marketplaces = pgTable("marketplaces", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    code: text("code").notNull().unique(),
    contactId: uuid("contact_id").references(() => contacts.id),
    priceGroupId: uuid("price_group_id").references(() => priceGroups.id),
    categoryAttributeId: uuid("category_attribute_id").references(() => productAttributes.id),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
        .defaultNow()
        .notNull()
        .$onUpdate(() => new Date()),
});

export const marketplaceFeeRules = pgTable("marketplace_fee_rules", {
    id: uuid("id").defaultRandom().primaryKey(),
    marketplaceId: uuid("marketplace_id")
        .notNull()
        .references(() => marketplaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type", { enum: ["percentage", "fixed"] }).notNull().default("percentage"),
    value: decimalAsNumber(12, 2)("value").notNull().default(0),
    category: text("category"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
        .defaultNow()
        .notNull()
        .$onUpdate(() => new Date()),
});

export const marketplacesRelations = relations(marketplaces, ({ one, many }) => ({
    contact: one(contacts, {
        fields: [marketplaces.contactId],
        references: [contacts.id],
    }),
    priceGroup: one(priceGroups, {
        fields: [marketplaces.priceGroupId],
        references: [priceGroups.id],
    }),
    categoryAttribute: one(productAttributes, {
        fields: [marketplaces.categoryAttributeId],
        references: [productAttributes.id],
    }),
    feeRules: many(marketplaceFeeRules),
}));

export const marketplaceFeeRulesRelations = relations(marketplaceFeeRules, ({ one }) => ({
    marketplace: one(marketplaces, {
        fields: [marketplaceFeeRules.marketplaceId],
        references: [marketplaces.id],
    }),
}));
