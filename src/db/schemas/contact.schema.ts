import {
    boolean,
    decimal,
    pgEnum,
    pgTable,
    smallint,
    text,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";
import { priceGroups } from "./price-group.schema";

export const contactTypeEnum = pgEnum("contact_type", ["customer", "supplier"]);

export const contacts = pgTable("contacts", {
    id: uuid("id").defaultRandom().primaryKey(),
    contactType: contactTypeEnum("contact_type").notNull(),
    termOfPayment: smallint("term_of_payment").notNull().default(0),
    creditLimit: decimal("credit_limit", { precision: 15, scale: 2 }).default(
        "0",
    ),
    invoiceLimit: smallint("invoice_limit").default(0),
    name: text("name").notNull().unique(),
    address: text("address").notNull(),
    phone: text("phone").notNull(),
    email: text("email").notNull(),
    priceGroupId: uuid("price_group_id").references(() => priceGroups.id),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
        .defaultNow()
        .notNull()
        .$onUpdate(() => new Date()),
});
