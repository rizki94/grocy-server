import {
    boolean,
    decimal,
    integer,
    pgTable,
    text,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";
import { products } from "./product.schema";
import { contacts } from "./contact.schema";
import { transactions } from "./transaction.schema";
import { branches } from "./branch.schema";

export const promotions = pgTable("promotions", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    // "discount_percentage" | "discount_nominal" | "buy_x_get_y" | "min_spend" | "member_tier"
    type: text("type").notNull().default("discount_percentage"),
    discountPercent: decimal("discount_percent", { precision: 5, scale: 2 }).default("0"),
    discountAmount: decimal("discount_amount", { precision: 12, scale: 2 }).default("0"),
    minSpend: decimal("min_spend", { precision: 12, scale: 2 }).default("0"),
    maxDiscount: decimal("max_discount", { precision: 12, scale: 2 }).default("0"),
    // Buy X Get Y details
    buyProductId: uuid("buy_product_id").references(() => products.id),
    buyQty: integer("buy_qty").default(1),
    getProductId: uuid("get_product_id").references(() => products.id),
    getQty: integer("get_qty").default(1),
    getDiscountPercent: decimal("get_discount_percent", { precision: 5, scale: 2 }).default("100"), // 100 = Free
    // Member Tier restriction (e.g. "all", "silver", "gold", "platinum")
    memberTier: text("member_tier").default("all"),
    branchId: uuid("branch_id").references(() => branches.id),
    startDate: timestamp("start_date").notNull(),
    endDate: timestamp("end_date").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
        .defaultNow()
        .notNull()
        .$onUpdate(() => new Date()),
});

export const vouchers = pgTable("vouchers", {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    // "percentage" | "nominal"
    type: text("type").notNull().default("nominal"),
    value: decimal("value", { precision: 12, scale: 2 }).notNull().default("0"),
    minSpend: decimal("min_spend", { precision: 12, scale: 2 }).default("0"),
    maxDiscount: decimal("max_discount", { precision: 12, scale: 2 }).default("0"),
    quota: integer("quota").notNull().default(100),
    usedCount: integer("used_count").notNull().default(0),
    memberOnly: boolean("member_only").notNull().default(false),
    startDate: timestamp("start_date").notNull(),
    endDate: timestamp("end_date").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
        .defaultNow()
        .notNull()
        .$onUpdate(() => new Date()),
});

export const voucherUsages = pgTable("voucher_usages", {
    id: uuid("id").defaultRandom().primaryKey(),
    voucherId: uuid("voucher_id")
        .notNull()
        .references(() => vouchers.id, { onDelete: "cascade" }),
    transactionId: uuid("transaction_id").references(() => transactions.id, { onDelete: "set null" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    discountAmount: decimal("discount_amount", { precision: 12, scale: 2 }).notNull().default("0"),
    usedAt: timestamp("used_at").defaultNow().notNull(),
});
