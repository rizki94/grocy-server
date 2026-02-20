import { decimalAsNumber } from "@/types/decimal-as-number";
import {
    date,
    pgEnum,
    pgTable,
    smallint,
    text,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";
import { contacts } from "./contact.schema";
import { users } from "./user.schema";
import {
    transactionStatuses,
    transactionTypes,
} from "@/constants/transaction.constant";
import { productDetails, products } from "./product.schema";
import { warehouses } from "./warehouse.schema";
import { relations } from "drizzle-orm";

export const transactionStatusEnum = pgEnum(
    "transaction_status",
    transactionStatuses,
);

export const transactionTypeEnum = pgEnum("transaction_type", transactionTypes);

export const transactions = pgTable("transactions", {
    id: uuid("id").defaultRandom().primaryKey(),
    type: transactionTypeEnum("type").notNull(),
    invoice: text("invoice").notNull().unique(),
    contactId: uuid("contact_id").references(() => contacts.id),
    date: date("date").notNull(),
    termOfPayment: smallint("term_of_payment").notNull().default(0),
    reference: text("reference"),
    note: text("note"),
    subtotal: decimalAsNumber(12, 2)("subtotal").notNull().default(0),
    totalDiscount: decimalAsNumber(12, 2)("total_discount")
        .notNull()
        .default(0),
    totalAmount: decimalAsNumber(12, 2)("total_amount").notNull().default(0),
    totalTax: decimalAsNumber(12, 2)("total_tax").notNull().default(0),
    status: transactionStatusEnum("status").notNull().default("order"),
    userId: uuid("user_id")
        .notNull()
        .references(() => users.id),
    parentId: uuid("parent_id").references((): any => transactions.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
        .defaultNow()
        .notNull()
        .$onUpdate(() => new Date()),
});

export const transactionDetails = pgTable("transaction_details", {
    id: uuid("id").defaultRandom().primaryKey(),
    transactionId: uuid("transaction_id")
        .notNull()
        .references(() => transactions.id),
    productId: uuid("product_id")
        .notNull()
        .references(() => products.id),
    productDetailId: uuid("product_detail_id")
        .notNull()
        .references(() => productDetails.id),
    warehouseId: uuid("warehouse_id").references(() => warehouses.id),
    movementType: smallint("movement_type").notNull().default(1),
    qty: decimalAsNumber(10, 2)("qty").notNull().default(0),
    baseRatio: decimalAsNumber(10, 2)("base_ratio").notNull().default(0),
    price: decimalAsNumber(10, 2)("price").notNull().default(0),
    discount: decimalAsNumber(10, 2)("discount").notNull().default(0),
    amount: decimalAsNumber(19, 2)("amount").notNull().default(0),
    unitCost: decimalAsNumber(12, 2)("unit_cost").notNull().default(0),
    totalCost: decimalAsNumber(12, 2)("total_cost").notNull().default(0),
    taxRate: decimalAsNumber(5, 2)("tax_rate").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
        .defaultNow()
        .notNull()
        .$onUpdate(() => new Date()),
});

export const transactionsRelations = relations(
    transactions,
    ({ one, many }) => ({
        contact: one(contacts, {
            fields: [transactions.contactId],
            references: [contacts.id],
        }),
        parent: one(transactions, {
            fields: [transactions.parentId],
            references: [transactions.id],
            relationName: "parent_child",
        }),
        children: many(transactions, {
            relationName: "parent_child",
        }),
        details: many(transactionDetails),
    }),
);

export const transactionDetailsRelations = relations(
    transactionDetails,
    ({ one }) => ({
        transaction: one(transactions, {
            fields: [transactionDetails.transactionId],
            references: [transactions.id],
        }),
        product: one(products, {
            fields: [transactionDetails.productId],
            references: [products.id],
        }),
        productDetail: one(productDetails, {
            fields: [transactionDetails.productDetailId],
            references: [productDetails.id],
        }),
    }),
);
