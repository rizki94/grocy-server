import { attributeType } from "@/constants/product.constant";
import {
    jsonb,
    pgEnum,
    pgTable,
    text,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";
import { products } from "./product.schema";

export const productAttributeTypeEnum = pgEnum(
    "product_attribute_type",
    attributeType,
);

export const productAttributes = pgTable("product_attributes", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    label: text("label").notNull(),
    type: productAttributeTypeEnum("type").notNull(),
    options: jsonb("options"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const productAttributeValues = pgTable("product_attribute_values", {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
        .notNull()
        .references(() => products.id, { onDelete: "cascade" }),
    attributeId: uuid("attribute_id")
        .notNull()
        .references(() => productAttributes.id, { onDelete: "cascade" }),
    value: text("value").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});
