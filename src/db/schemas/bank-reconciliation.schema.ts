import { pgTable, text, uuid, date, timestamp, pgEnum, boolean } from "drizzle-orm/pg-core";
import { decimalAsNumber } from "@/types/decimal-as-number";
import { users } from "./user.schema";
import { branches } from "./branch.schema";
import { glAccounts } from "./gl-account.schema";
import { journalEntries } from "./journal.schema";
import { relations } from "drizzle-orm";

export const bankReconciliationStatusEnum = pgEnum("bank_reconciliation_status", [
    "draft",
    "reconciled",
    "cancelled",
]);

/**
 * Bank Reconciliation header
 */
export const bankReconciliations = pgTable("bank_reconciliations", {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull().unique(),                      // e.g. BRC-20261022-0001
    name: text("name").notNull(),                               // e.g. Rekonsiliasi BCA - Okt 2026
    bankAccountId: uuid("bank_account_id").notNull().references(() => glAccounts.id),
    reconciliationDate: date("reconciliation_date").notNull(),
    openingBalance: decimalAsNumber(12, 2)("opening_balance").notNull().default(0),
    statementBalance: decimalAsNumber(12, 2)("statement_balance").notNull().default(0),
    clearedBalance: decimalAsNumber(12, 2)("cleared_balance").notNull().default(0),
    difference: decimalAsNumber(12, 2)("difference").notNull().default(0),
    status: bankReconciliationStatusEnum("status").notNull().default("draft"),
    note: text("note"),
    branchId: uuid("branch_id").references(() => branches.id),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    reconciledBy: uuid("reconciled_by").references(() => users.id),
    reconciledAt: timestamp("reconciled_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
});

/**
 * Bank Reconciliation items (cash/bank journal entries matched or pending)
 */
export const bankReconciliationItems = pgTable("bank_reconciliation_items", {
    id: uuid("id").defaultRandom().primaryKey(),
    bankReconciliationId: uuid("bank_reconciliation_id")
        .notNull()
        .references(() => bankReconciliations.id, { onDelete: "cascade" }),
    journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id),
    transactionDate: date("transaction_date").notNull(),
    reference: text("reference"),                               // invoice / ref no
    description: text("description"),
    debit: decimalAsNumber(12, 2)("debit").notNull().default(0),    // Deposits (Cash In)
    credit: decimalAsNumber(12, 2)("credit").notNull().default(0),  // Payments/Withdrawals (Cash Out)
    isCleared: boolean("is_cleared").notNull().default(false),
    clearedAt: timestamp("cleared_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
});

export const bankReconciliationRelations = relations(bankReconciliations, ({ one, many }) => ({
    bankAccount: one(glAccounts, { fields: [bankReconciliations.bankAccountId], references: [glAccounts.id] }),
    branch: one(branches, { fields: [bankReconciliations.branchId], references: [branches.id] }),
    createdByUser: one(users, { fields: [bankReconciliations.createdBy], references: [users.id] }),
    reconciledByUser: one(users, { fields: [bankReconciliations.reconciledBy], references: [users.id] }),
    items: many(bankReconciliationItems),
}));

export const bankReconciliationItemRelations = relations(bankReconciliationItems, ({ one }) => ({
    bankReconciliation: one(bankReconciliations, {
        fields: [bankReconciliationItems.bankReconciliationId],
        references: [bankReconciliations.id],
    }),
    journalEntry: one(journalEntries, {
        fields: [bankReconciliationItems.journalEntryId],
        references: [journalEntries.id],
    }),
}));
