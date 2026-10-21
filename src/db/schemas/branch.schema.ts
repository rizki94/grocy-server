import { boolean, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { products } from "./product.schema";

export const branches = pgTable("branches", {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull().unique(), // e.g. "HQ", "JKT-01", "SBY-01"
    name: text("name").notNull(),          // e.g. "Headquarters", "Cabang Jakarta"
    address: text("address"),
    phone: text("phone"),
    isHq: boolean("is_hq").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
        .defaultNow()
        .notNull()
        .$onUpdate(() => new Date()),
});

export const productBranches = pgTable(
    "product_branches",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        productId: uuid("product_id")
            .notNull()
            .references(() => products.id, { onDelete: "cascade" }),
        branchId: uuid("branch_id")
            .notNull()
            .references(() => branches.id, { onDelete: "cascade" }),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (t) => [unique().on(t.productId, t.branchId)]
);

export const branchesRelations = relations(branches, ({ many }) => ({
    productBranches: many(productBranches),
}));

export const productBranchesRelations = relations(productBranches, ({ one }) => ({
    branch: one(branches, {
        fields: [productBranches.branchId],
        references: [branches.id],
    }),
    product: one(products, {
        fields: [productBranches.productId],
        references: [products.id],
    }),
}));
