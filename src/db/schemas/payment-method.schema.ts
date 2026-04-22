import { pgTable, text, timestamp, uuid, boolean } from "drizzle-orm/pg-core";
import { glAccounts } from "./gl-account.schema";
import { relations } from "drizzle-orm";

export const paymentMethods = pgTable("payment_methods", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull().unique(), // e.g., 'Cash', 'Bank Transfer', 'QRIS'
    color: text("color"), // HEX or Tailwind color class
    icon: text("icon"), // Icon identifier or name
    isCash: boolean("is_cash").default(false).notNull(),
    glAccountId: uuid("gl_account_id").references(() => glAccounts.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
        .defaultNow()
        .notNull()
        .$onUpdate(() => new Date()),
});

export const paymentMethodsRelations = relations(paymentMethods, ({ one }) => ({
    glAccount: one(glAccounts, {
        fields: [paymentMethods.glAccountId],
        references: [glAccounts.id],
    }),
}));
