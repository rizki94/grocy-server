import { pgEnum, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./user.schema";
import { decimalAsNumber } from "@/types/decimal-as-number";
import { relations } from "drizzle-orm";
import { transactions } from "./transaction.schema";

export const posSessionStatusEnum = pgEnum("pos_session_status", [
    "open",
    "closed",
]);

export const posSessions = pgTable("pos_sessions", {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
        .notNull()
        .references(() => users.id),
    status: posSessionStatusEnum("status").notNull().default("open"),
    openingBalance: decimalAsNumber(12, 2)("opening_balance")
        .notNull()
        .default(0),
    closingBalance: decimalAsNumber(12, 2)("closing_balance"),
    openedAt: timestamp("opened_at").defaultNow().notNull(),
    closedAt: timestamp("closed_at"),
});

export const posSessionsRelations = relations(posSessions, ({ one, many }) => ({
    user: one(users, {
        fields: [posSessions.userId],
        references: [users.id],
    }),
    transactions: many(transactions),
}));
