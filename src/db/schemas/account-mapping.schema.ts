import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { transactionTypeEnum } from "./transaction.schema";
import { glAccounts } from "./gl-account.schema";

export const accountMappings = pgTable("account_mappings", {
    id: uuid("id").defaultRandom().primaryKey(),
    type: transactionTypeEnum("type").notNull(),

    side: text("side", { enum: ["debit", "credit"] }),
    glAccountCode: text("gl_account_code")
        .notNull()
        .references(() => glAccounts.code),
    note: text("note"),
});
