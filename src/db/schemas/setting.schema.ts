import { pgTable, boolean, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { glAccounts } from "./gl-account.schema";
import { relations } from "drizzle-orm";

export const settings = pgTable("settings", {
    id: text("id").primaryKey(), // just a string key "global"
    posRound2Digit: boolean("pos_round_2_digit").default(false).notNull(),
    allowNegativeStock: boolean("allow_negative_stock").default(false).notNull(),
    roundingDifferenceGlAccountId: uuid("rounding_difference_gl_account_id").references(() => glAccounts.id),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const settingsRelations = relations(settings, ({ one }) => ({
    roundingDifferenceGlAccount: one(glAccounts, {
        fields: [settings.roundingDifferenceGlAccountId],
        references: [glAccounts.id],
    }),
}));
