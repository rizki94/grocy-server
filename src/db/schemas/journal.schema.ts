import {
    boolean,
    date,
    pgTable,
    text,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";
import { transactions } from "./transaction.schema";
import { decimalAsNumber } from "@/types/decimal-as-number";
import { glAccounts } from "./gl-account.schema";

export const journals = pgTable("journals", {
    id: uuid("id").defaultRandom().primaryKey(),
    transactionId: uuid("transaction_id").references(() => transactions.id),
    date: date("date").notNull(),
    description: text("description"),
    status: text("status", {
        enum: ["draft", "posted", "cancelled"],
    })
        .notNull()
        .default("draft"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
        .defaultNow()
        .notNull()
        .$onUpdate(() => new Date()),
});

export const journalEntries = pgTable("journal_entries", {
    id: uuid("id").defaultRandom().primaryKey(),
    journalId: uuid("journal_id").references(() => journals.id, {
        onDelete: "cascade",
    }),
    glAccountId: uuid("account_id").references(() => glAccounts.id),
    debit: decimalAsNumber(12, 2)("debit").notNull().default(0),
    credit: decimalAsNumber(12, 2)("credit").notNull().default(0),
    note: text("note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
        .defaultNow()
        .notNull()
        .$onUpdate(() => new Date()),
});
