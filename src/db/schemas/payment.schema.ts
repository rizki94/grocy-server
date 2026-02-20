import { date, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { transactions } from "./transaction.schema";
import { decimalAsNumber } from "@/types/decimal-as-number";
import { contacts } from "./contact.schema";
import { glAccounts } from "./gl-account.schema";

export const openInvoices = pgTable("open_invoices", {
    id: uuid("id").defaultRandom().primaryKey(),
    transactionId: uuid("transaction_id").references(() => transactions.id),
    contactId: uuid("contact_id").references(() => contacts.id),
    type: text("type", { enum: ["receivable", "payable"] }).notNull(),
    dueDate: date("due_date").notNull(),
    amount: decimalAsNumber(12, 2)("amount").notNull().default(0),
    paidAmount: decimalAsNumber(12, 2)("paid_amount").notNull().default(0),
    status: text("status", { enum: ["open", "partial", "paid"] })
        .notNull()
        .default("open"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
        .defaultNow()
        .notNull()
        .$onUpdate(() => new Date()),
});

export const payments = pgTable("payments", {
    id: uuid("id").defaultRandom().primaryKey(),
    contactId: uuid("contact_id").references(() => contacts.id),
    date: date("date").notNull(),
    type: text("type", { enum: ["receivable", "payable"] }).notNull(),
    totalAmount: decimalAsNumber(12, 2)("total_amount").notNull().default(0),
    status: text("status", { enum: ["draft", "posted", "cancelled"] })
        .notNull()
        .default("draft"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
        .defaultNow()
        .notNull()
        .$onUpdate(() => new Date()),
});

export const paymentLines = pgTable("payment_lines", {
    id: uuid("id").defaultRandom().primaryKey(),
    paymentId: uuid("payment_id").references(() => payments.id, {
        onDelete: "cascade",
    }),
    openInvoiceId: uuid("open_invoice_id")
        .notNull()
        .references(() => openInvoices.id),
    amount: decimalAsNumber(12, 2)("amount").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
        .defaultNow()
        .notNull()
        .$onUpdate(() => new Date()),
});

export const paymentAccounts = pgTable("payment_accounts", {
    id: uuid("id").defaultRandom().primaryKey(),
    paymentId: uuid("payment_id").references(() => payments.id, {
        onDelete: "cascade",
    }),
    glAccountId: uuid("gl_account_id").references(() => glAccounts.id),
    amount: decimalAsNumber(12, 2)("amount").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
        .defaultNow()
        .notNull()
        .$onUpdate(() => new Date()),
});
