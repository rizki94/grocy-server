import { decimalAsNumber } from "@/types/decimal-as-number";
import {
    boolean,
    integer,
    pgTable,
    smallint,
    text,
    timestamp,
    unique,
    uuid,
} from "drizzle-orm/pg-core";
import { taxes } from "./tax.schema";
import { productUnits } from "./product-unit.schema";
import { priceGroups } from "./price-group.schema";

export const products = pgTable("products", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull().unique(),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    taxId: uuid("tax_id").references(() => taxes.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
        .defaultNow()
        .notNull()
        .$onUpdate(() => new Date()),
});

export const productDetails = pgTable("product_details", {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
        .notNull()
        .references(() => products.id),
    unitId: uuid("unit_id")
        .notNull()
        .references(() => productUnits.id),
    skuId: text("sku_id").notNull().unique(),
    barcode: text("barcode").unique(),
    level: smallint("level").notNull(),
    ratio: smallint("ratio").notNull(),
    baseRatio: smallint("base_ratio").notNull(),
    cost: decimalAsNumber(10, 2)("cost").notNull().default(0),
    weight: decimalAsNumber(10, 2)("weight").notNull().default(0),
    volume: decimalAsNumber(10, 3)("volume").notNull().default(0),
    length: decimalAsNumber(10, 3)("length").notNull().default(0),
    width: decimalAsNumber(10, 3)("width").notNull().default(0),
    height: decimalAsNumber(10, 3)("height").notNull().default(0),
    isSellable: boolean("is_sellable").notNull().default(true),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
        .defaultNow()
        .notNull()
        .$onUpdate(() => new Date()),
});

export const productImages = pgTable("product_images", {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
        .notNull()
        .references(() => products.id),
    url: text("url").notNull(),
    filename: text("filename").notNull(),
    mimetype: text("mimetype").notNull(),
    size: integer("size").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const productDetailPrices = pgTable(
    "product_detail_prices",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        productDetailId: uuid("product_detail_id")
            .notNull()
            .references(() => productDetails.id, { onDelete: "cascade" }),
        priceGroupId: uuid("price_group_id")
            .notNull()
            .references(() => priceGroups.id, { onDelete: "cascade" }),
        price: decimalAsNumber(12, 2)("price").notNull().default(0),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .notNull()
            .$onUpdate(() => new Date()),
    },
    (t) => [unique().on(t.productDetailId, t.priceGroupId)],
);
