import { pgTable, text, uuid, date, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { decimalAsNumber } from "@/types/decimal-as-number";
import { users } from "./user.schema";
import { branches } from "./branch.schema";
import { warehouses } from "./warehouse.schema";
import { products, productDetails } from "./product.schema";
import { transactions } from "./transaction.schema";
import { relations } from "drizzle-orm";

export const stockOpnameStatusEnum = pgEnum("stock_opname_status", [
    "draft",
    "in_progress",
    "completed",
    "cancelled",
]);

/**
 * Stock Opname (Physical Inventory Count) header
 */
export const stockOpnames = pgTable("stock_opnames", {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull().unique(),              // e.g. OPN-20261022-0001
    name: text("name").notNull(),                       // Human-readable name
    branchId: uuid("branch_id").references(() => branches.id),
    warehouseId: uuid("warehouse_id").references(() => warehouses.id),
    countDate: date("count_date").notNull(),
    status: stockOpnameStatusEnum("status").notNull().default("draft"),
    note: text("note"),
    // auto-generated adjustment ref (set after completion)
    adjustmentTransactionId: uuid("adjustment_transaction_id").references(() => transactions.id),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    completedBy: uuid("completed_by").references(() => users.id),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
});

/**
 * Stock Opname line items – one row per product+variant+warehouse
 */
export const stockOpnameItems = pgTable("stock_opname_items", {
    id: uuid("id").defaultRandom().primaryKey(),
    stockOpnameId: uuid("stock_opname_id")
        .notNull()
        .references(() => stockOpnames.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id),
    productDetailId: uuid("product_detail_id").notNull().references(() => productDetails.id),
    warehouseId: uuid("warehouse_id").references(() => warehouses.id),
    batchNumber: text("batch_number"),
    expiryDate: date("expiry_date"),
    systemQty: decimalAsNumber(12, 2)("system_qty").notNull().default(0),   // from stock table at snapshot
    physicalQty: decimalAsNumber(12, 2)("physical_qty"),                     // entered by counter
    difference: decimalAsNumber(12, 2)("difference"),                        // physicalQty - systemQty
    unitCost: decimalAsNumber(12, 2)("unit_cost").notNull().default(0),
    note: text("note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
});

export const stockOpnameRelations = relations(stockOpnames, ({ one, many }) => ({
    branch: one(branches, { fields: [stockOpnames.branchId], references: [branches.id] }),
    warehouse: one(warehouses, { fields: [stockOpnames.warehouseId], references: [warehouses.id] }),
    createdByUser: one(users, { fields: [stockOpnames.createdBy], references: [users.id] }),
    completedByUser: one(users, { fields: [stockOpnames.completedBy], references: [users.id] }),
    adjustmentTransaction: one(transactions, {
        fields: [stockOpnames.adjustmentTransactionId],
        references: [transactions.id],
    }),
    items: many(stockOpnameItems),
}));

export const stockOpnameItemRelations = relations(stockOpnameItems, ({ one }) => ({
    stockOpname: one(stockOpnames, {
        fields: [stockOpnameItems.stockOpnameId],
        references: [stockOpnames.id],
    }),
    product: one(products, { fields: [stockOpnameItems.productId], references: [products.id] }),
    productDetail: one(productDetails, {
        fields: [stockOpnameItems.productDetailId],
        references: [productDetails.id],
    }),
    warehouse: one(warehouses, { fields: [stockOpnameItems.warehouseId], references: [warehouses.id] }),
}));
