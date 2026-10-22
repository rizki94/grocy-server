import { date, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { branches } from "./branch.schema";
import { journals } from "./journal.schema";
import { users } from "./user.schema";
import { decimalAsNumber } from "@/types/decimal-as-number";
import { relations } from "drizzle-orm";

export const periodClosings = pgTable("period_closings", {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id").references(() => branches.id, {
        onDelete: "set null",
    }),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    closingJournalId: uuid("closing_journal_id").references(() => journals.id, {
        onDelete: "set null",
    }),
    totalIncome: decimalAsNumber(12, 2)("total_income").notNull().default(0),
    totalExpense: decimalAsNumber(12, 2)("total_expense").notNull().default(0),
    netProfit: decimalAsNumber(12, 2)("net_profit").notNull().default(0),
    status: text("status", { enum: ["closed", "reopened"] })
        .notNull()
        .default("closed"),
    notes: text("notes"),
    closedBy: uuid("closed_by").references(() => users.id, {
        onDelete: "set null",
    }),
    closedAt: timestamp("closed_at").defaultNow().notNull(),
    reopenedBy: uuid("reopened_by").references(() => users.id, {
        onDelete: "set null",
    }),
    reopenedAt: timestamp("reopened_at"),
    reopenReason: text("reopen_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
        .defaultNow()
        .notNull()
        .$onUpdate(() => new Date()),
});

export const periodClosingsRelations = relations(periodClosings, ({ one }) => ({
    branch: one(branches, {
        fields: [periodClosings.branchId],
        references: [branches.id],
    }),
    closingJournal: one(journals, {
        fields: [periodClosings.closingJournalId],
        references: [journals.id],
    }),
    closer: one(users, {
        fields: [periodClosings.closedBy],
        references: [users.id],
    }),
    reopener: one(users, {
        fields: [periodClosings.reopenedBy],
        references: [users.id],
    }),
}));
