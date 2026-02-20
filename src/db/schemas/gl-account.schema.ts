import { glAccountType } from "@/constants/journal.constant";
import {
    AnyPgColumn,
    boolean,
    pgEnum,
    pgTable,
    text,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";

export const glAccountTypeEnum = pgEnum("gl_account_type", glAccountType);

export const glAccounts = pgTable("gl_accounts", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    code: text("code").notNull().unique(),
    type: glAccountTypeEnum("type").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => glAccounts.id),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
        .defaultNow()
        .notNull()
        .$onUpdate(() => new Date()),
});
