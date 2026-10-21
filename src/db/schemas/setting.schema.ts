import { pgTable, boolean, uuid, text, timestamp, integer } from "drizzle-orm/pg-core";
import { glAccounts } from "./gl-account.schema";
import { relations } from "drizzle-orm";

export const settings = pgTable("settings", {
    id: text("id").primaryKey(), // just a string key "global"
    posRound2Digit: boolean("pos_round_2_digit").default(false).notNull(),
    allowNegativeStock: boolean("allow_negative_stock").default(false).notNull(),
    enableInventoryTracking: boolean("enable_inventory_tracking").default(true).notNull(),
    roundingDifferenceGlAccountId: uuid("rounding_difference_gl_account_id").references(() => glAccounts.id),
    // Sysadmin controls
    minDateOffset: integer("min_date_offset").default(-365).notNull(),    // days relative to today (negative = past)
    maxDateOffset: integer("max_date_offset").default(30).notNull(),      // days relative to today (positive = future)
    lockSalesPrice: boolean("lock_sales_price").default(false).notNull(), // prevent manual price edits in sales
    enableTax: boolean("enable_tax").default(true).notNull(),             // global tax toggle
    // Transaction code / prefix settings
    purchasePrefix: text("purchase_prefix").default("PUR").notNull(),
    salesPrefix: text("sales_prefix").default("SLS").notNull(),
    salesReturnPrefix: text("sales_return_prefix").default("SLR").notNull(),
    purchaseReturnPrefix: text("purchase_return_prefix").default("PCR").notNull(),
    transferStockPrefix: text("transfer_stock_prefix").default("TRF").notNull(),
    adjustmentPrefix: text("adjustment_prefix").default("ADJ").notNull(),
    posSalesPrefix: text("pos_sales_prefix").default("POS").notNull(),
    expensePrefix: text("expense_prefix").default("EXP").notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const settingsRelations = relations(settings, ({ one }) => ({
    roundingDifferenceGlAccount: one(glAccounts, {
        fields: [settings.roundingDifferenceGlAccountId],
        references: [glAccounts.id],
    }),
}));
