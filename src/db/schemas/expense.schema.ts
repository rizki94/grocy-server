import { date, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { decimalAsNumber } from "@/types/decimal-as-number";
import { glAccounts } from "./gl-account.schema";
import { branches } from "./branch.schema";
import { users } from "./user.schema";
import { journals } from "./journal.schema";
import { relations } from "drizzle-orm";

export const expenses = pgTable("expenses", {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull().unique(),
    date: date("date").notNull(),
    paymentAccountId: uuid("payment_account_id")
        .notNull()
        .references(() => glAccounts.id),
    branchId: uuid("branch_id")
        .notNull()
        .references(() => branches.id),
    userId: uuid("user_id")
        .notNull()
        .references(() => users.id),
    totalAmount: decimalAsNumber(12, 2)("total_amount").notNull().default(0),
    reference: text("reference"),
    description: text("description"),
    status: text("status", { enum: ["draft", "posted", "cancelled"] })
        .notNull()
        .default("posted"),
    journalId: uuid("journal_id").references(() => journals.id, {
        onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
        .defaultNow()
        .notNull()
        .$onUpdate(() => new Date()),
});

export const expenseLines = pgTable("expense_lines", {
    id: uuid("id").defaultRandom().primaryKey(),
    expenseId: uuid("expense_id")
        .notNull()
        .references(() => expenses.id, { onDelete: "cascade" }),
    glAccountId: uuid("gl_account_id")
        .notNull()
        .references(() => glAccounts.id),
    amount: decimalAsNumber(12, 2)("amount").notNull().default(0),
    note: text("note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
        .defaultNow()
        .notNull()
        .$onUpdate(() => new Date()),
});

export const expensesRelations = relations(expenses, ({ one, many }) => ({
    paymentAccount: one(glAccounts, {
        fields: [expenses.paymentAccountId],
        references: [glAccounts.id],
    }),
    branch: one(branches, {
        fields: [expenses.branchId],
        references: [branches.id],
    }),
    user: one(users, {
        fields: [expenses.userId],
        references: [users.id],
    }),
    journal: one(journals, {
        fields: [expenses.journalId],
        references: [journals.id],
    }),
    lines: many(expenseLines),
}));

export const expenseLinesRelations = relations(expenseLines, ({ one }) => ({
    expense: one(expenses, {
        fields: [expenseLines.expenseId],
        references: [expenses.id],
    }),
    glAccount: one(glAccounts, {
        fields: [expenseLines.glAccountId],
        references: [glAccounts.id],
    }),
}));
