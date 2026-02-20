import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { decimalAsNumber } from "@/types/decimal-as-number";
import { products } from "./product.schema";
import { transactions } from "./transaction.schema";

import { warehouses } from "./warehouse.schema";

export const stocks = pgTable(
    "stocks",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        productId: uuid("product_id")
            .notNull()
            .references(() => products.id),
        warehouseId: uuid("warehouse_id").references(() => warehouses.id),
        qty: decimalAsNumber(12, 2)("qty").notNull().default(0),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .notNull()
            .$onUpdate(() => new Date()),
    },
    (t) => [unique().on(t.productId, t.warehouseId)],
);

export const stockMovements = pgTable("stock_movements", {
    id: uuid("id").defaultRandom().primaryKey(),
    stockId: uuid("stock_id")
        .notNull()
        .references(() => stocks.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["IN", "OUT", "ADJUSTMENT"] }).notNull(),
    qty: decimalAsNumber(12, 2)("quantity").notNull(),
    unitCost: decimalAsNumber(12, 2)("unit_cost"),
    transactionId: uuid("transaction_id")
        .notNull()
        .references(() => transactions.id, { onDelete: "cascade" }),
    note: text("note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const stockLayers = pgTable("stock_layers", {
    id: uuid("id").defaultRandom().primaryKey(),
    stockId: uuid("stock_id")
        .notNull()
        .references(() => stocks.id, { onDelete: "cascade" }),
    movementId: uuid("movement_id")
        .notNull()
        .references(() => stockMovements.id, { onDelete: "cascade" }),
    remainingQty: decimalAsNumber(12, 2)("remaining_qty").notNull(),
    unitCost: decimalAsNumber(12, 2)("unit_cost").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});
