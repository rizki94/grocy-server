import { date, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { decimalAsNumber } from "@/types/decimal-as-number";
import { glAccounts } from "./gl-account.schema";
import { branches } from "./branch.schema";
import { users } from "./user.schema";
import { journals } from "./journal.schema";
import { relations } from "drizzle-orm";

export const incomes = pgTable("incomes", {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull().unique(),
    date: date("date").notNull(),
    depositAccountId: uuid("deposit_account_id")
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
        .default("draft"),
    journalId: uuid("journal_id").references(() => journals.id, {
        onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
        .defaultNow()
        .notNull()
        .$onUpdate(() => new Date()),
});

export const incomeLines = pgTable("income_lines", {
    id: uuid("id").defaultRandom().primaryKey(),
    incomeId: uuid("income_id")
        .notNull()
        .references(() => incomes.id, { onDelete: "cascade" }),
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

export const incomesRelations = relations(incomes, ({ one, many }) => ({
    depositAccount: one(glAccounts, {
        fields: [incomes.depositAccountId],
        references: [glAccounts.id],
    }),
    branch: one(branches, {
        fields: [incomes.branchId],
        references: [branches.id],
    }),
    user: one(users, {
        fields: [incomes.userId],
        references: [users.id],
    }),
    journal: one(journals, {
        fields: [incomes.journalId],
        references: [journals.id],
    }),
    lines: many(incomeLines),
}));

export const incomeLinesRelations = relations(incomeLines, ({ one }) => ({
    income: one(incomes, {
        fields: [incomeLines.incomeId],
        references: [incomes.id],
    }),
    glAccount: one(glAccounts, {
        fields: [incomeLines.glAccountId],
        references: [glAccounts.id],
    }),
}));
