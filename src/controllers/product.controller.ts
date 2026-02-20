import { db } from "@/db";
import {
    productAttributeValues,
    productDetails,
    productImages,
    productUnits,
    products,
    productDetailPrices,
    stockLayers,
    stocks,
    taxes,
} from "@/db/schemas";
import { logAction } from "@/utils/log-helper";
import { CacheService } from "@/services/cache-service";
import {
    productWithDetailInsertSchema,
    productWithDetailUpdateSchema,
} from "@/validators/product.validator";
import {
    and,
    asc,
    desc,
    eq,
    inArray,
    isNull,
    like,
    or,
    sql,
} from "drizzle-orm";
import { PgColumn } from "drizzle-orm/pg-core";
import { Request, Response } from "express";
import fs from "fs";
import path from "path";

export async function getAllProducts(req: Request, res: Response) {
    try {
        const data = await CacheService.getOrSet(
            "products:all",
            60,
            async () => {
                return db.select().from(products).orderBy(products.name);
            },
        );
        res.status(200).json(data);
    } catch (error) {
        console.error("Error fetching products:", error);
        res.status(500).json({ message: "Failed to fetch products" });
    }
}

export async function getActiveProducts(req: Request, res: Response) {
    try {
        const data = await db
            .select({
                id: products.id,
                productDetailId: productDetails.id,
                name: products.name,
                unitId: productDetails.unitId,
                unitName: sql<string>`COALESCE(${productUnits.name}, 'None')`,
                baseRatio: sql<number>`COALESCE(${productDetails.baseRatio}, 1)`,
                volume: sql<number>`COALESCE(${productDetails.volume}, 0)`,
                cost: sql<number>`COALESCE(${productDetails.cost}, 0)`,
                taxRate: sql<number>`COALESCE(${taxes.rate}, 0)`,
            })
            .from(products)
            .innerJoin(productDetails, eq(productDetails.productId, products.id))
            .leftJoin(productUnits, eq(productUnits.id, productDetails.unitId))
            .leftJoin(taxes, eq(taxes.id, products.taxId))
            .where(eq(products.isActive, true))
            .orderBy(products.name);

        const productDetailIds = data
            .map((d) => d.productDetailId)
            .filter(Boolean) as string[];

        const prices = productDetailIds.length > 0
            ? await db
                .select()
                .from(productDetailPrices)
                .where(inArray(productDetailPrices.productDetailId, productDetailIds))
            : [];

        const dataWithPrices = data.map(d => ({
            ...d,
            prices: prices.filter(p => p.productDetailId === d.productDetailId)
        }));

        res.status(200).json(dataWithPrices);
    } catch (error) {
        console.error("Error fetching products:", error);
        res.status(500).json({ message: "Failed to fetch products" });
    }
}

export const getProductById = async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!id) {
        return res.status(400).json({ message: "Product id is required" });
    }

    try {
        const product = await db
            .select()
            .from(products)
            .where(eq(products.id, id))
            .then((r) => r[0]);

        if (!product) {
            return res.status(404).json({ message: "Product not found" });
        }

        const details = await db
            .select()
            .from(productDetails)
            .where(eq(productDetails.productId, id))
            .orderBy(asc(productDetails.level));

        const prices = await db
            .select()
            .from(productDetailPrices)
            .where(
                details.length > 0
                    ? inArray(
                        productDetailPrices.productDetailId,
                        details.map((d) => d.id),
                    )
                    : sql`1 = 0`
            );

        const detailsWithPrices = details.map((d) => ({
            ...d,
            prices: prices.filter((p) => p.productDetailId === d.id),
        }));

        const attributes = await db
            .select()
            .from(productAttributeValues)
            .where(eq(productAttributeValues.productId, id));

        const images = await db
            .select()
            .from(productImages)
            .where(eq(productImages.productId, id));

        const stockInfo = await db
            .select({
                currentQty: stocks.qty,
                avgCost: sql<number>`COALESCE(SUM(${stockLayers.remainingQty} * ${stockLayers.unitCost}) / NULLIF(SUM(${stockLayers.remainingQty}), 0), 0)`,
            })
            .from(stocks)
            .leftJoin(stockLayers, eq(stockLayers.stockId, stocks.id))
            .where(eq(stocks.productId, id))
            .groupBy(stocks.id, stocks.qty)
            .then((r) => r[0]);

        const result = {
            ...product,
            details: detailsWithPrices,
            attributes,
            images,
            inventory: stockInfo || { currentQty: 0, avgCost: 0 },
        };

        return res.json(result);
    } catch (err) {
        console.error("GetProductById error:", err);
        return res
            .status(500)
            .json({ message: "Internal error", error: (err as Error).message });
    }
};

export const createProduct = async (req: Request, res: Response) => {
    const parsed = productWithDetailInsertSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    const product = parsed.data;

    try {
        const [createdProduct] = await db
            .insert(products)
            .values({
                name: product.name,
                description: product.description,
                isActive: product.isActive,
                taxId: product.taxId,
            })
            .returning();

        for (const d of product.details ?? []) {
            const [createdDetail] = await db
                .insert(productDetails)
                .values({
                    productId: createdProduct.id,
                    unitId: d.unitId,
                    skuId: d.skuId,
                    barcode: d.barcode,
                    level: d.level,
                    ratio: d.ratio,
                    baseRatio: d.baseRatio,
                    cost: d.cost ?? 0,
                    weight: d.weight ?? 0,
                    volume: d.volume ?? 0,
                    length: d.length ?? 0,
                    width: d.width ?? 0,
                    height: d.height ?? 0,
                    isSellable: d.isSellable,
                    isDefault: d.isDefault,
                })
                .returning();

            if (d.prices?.length) {
                await db.insert(productDetailPrices).values(
                    d.prices.map((p) => ({
                        productDetailId: createdDetail.id,
                        priceGroupId: p.priceGroupId,
                        price: p.price,
                    })),
                );
            }
        }

        if (product.attributes?.length) {
            await db.insert(productAttributeValues).values(
                product.attributes.map((a) => ({
                    productId: createdProduct.id,
                    attributeId: a.attributeId,
                    value: a.value,
                })),
            );
        }

        if (product.images?.length) {
            await db.insert(productImages).values(
                product.images.map((img) => ({
                    productId: createdProduct.id,
                    url: img.url,
                    filename: img.filename,
                    mimetype: img.mimetype ?? "image/*",
                    size: img.size ?? 0,
                })),
            );
        }

        logAction(req, {
            action: "insert",
            table: "products",
            data: { ...createdProduct, details: product.details, attributes: product.attributes, images: product.images },
            userId: req.user!.id,
            msg: `created product #${createdProduct.id}`,
        });

        return res
            .status(201)
            .json({ message: "Product created", productId: createdProduct.id });
    } catch (err) {
        console.error("CreateProduct error:", err);
        return res
            .status(500)
            .json({ message: "Internal error", error: (err as Error).message });
    }
};

export const updateProduct = async (req: Request, res: Response) => {
    const parsed = productWithDetailUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    const product = parsed.data;

    try {
        // Update main product
        const [updated] = await db
            .update(products)
            .set({
                name: product.name,
                description: product.description,
                isActive: product.isActive,
                taxId: product.taxId,
            })
            .where(eq(products.id, product.id))
            .returning();

        if (!updated) {
            return res.status(404).json({ message: "Product not found" });
        }

        // ----- PRODUCT DETAILS -----
        const existingDetails = await db
            .select()
            .from(productDetails)
            .where(eq(productDetails.productId, product.id));

        const existingDetailIds = new Set(existingDetails.map((d) => d.id));
        const incomingDetailIds = new Set(
            product.details?.map((d) => d.id).filter(Boolean),
        );

        // delete details that no longer exist
        const toDeleteDetails = existingDetails.filter(
            (d) => !incomingDetailIds.has(d.id),
        );
        if (toDeleteDetails.length) {
            await db.delete(productDetails).where(
                inArray(
                    productDetails.id,
                    toDeleteDetails.map((d) => d.id),
                ),
            );
        }

        // upsert details
        for (const d of product.details ?? []) {
            let detailId = d.id;

            if (detailId && existingDetailIds.has(detailId)) {
                // update existing
                await db
                    .update(productDetails)
                    .set({
                        unitId: d.unitId,
                        skuId: d.skuId,
                        barcode: d.barcode,
                        level: d.level,
                        ratio: d.ratio,
                        baseRatio: d.baseRatio,
                        cost: d.cost ?? 0,
                        weight: d.weight ?? 0,
                        volume: d.volume ?? 0,
                        length: d.length ?? 0,
                        width: d.width ?? 0,
                        height: d.height ?? 0,
                        isSellable: d.isSellable,
                        isDefault: d.isDefault,
                    })
                    .where(eq(productDetails.id, detailId));
            } else {
                // insert new
                const [newDetail] = await db
                    .insert(productDetails)
                    .values({
                        productId: product.id,
                        unitId: d.unitId,
                        skuId: d.skuId,
                        barcode: d.barcode,
                        level: d.level,
                        ratio: d.ratio,
                        baseRatio: d.baseRatio,
                        cost: d.cost ?? 0,
                        weight: d.weight ?? 0,
                        volume: d.volume ?? 0,
                        length: d.length ?? 0,
                        width: d.width ?? 0,
                        height: d.height ?? 0,
                        isSellable: d.isSellable,
                        isDefault: d.isDefault,
                    })
                    .returning();
                detailId = newDetail.id;
            }

            // Sync price group prices for this detail
            if (detailId) {
                const existingPrices = await db
                    .select()
                    .from(productDetailPrices)
                    .where(eq(productDetailPrices.productDetailId, detailId));

                const newPrices = d.prices ?? [];

                // delete removed prices
                const pricesToDelete = existingPrices.filter(
                    (ep) => !newPrices.some((np) => np.priceGroupId === ep.priceGroupId)
                );
                if (pricesToDelete.length) {
                    await db.delete(productDetailPrices).where(
                        inArray(
                            productDetailPrices.id,
                            pricesToDelete.map((p) => p.id)
                        )
                    );
                }

                // upsert prices
                for (const p of newPrices) {
                    const existingPrice = existingPrices.find(
                        (ep) => ep.priceGroupId === p.priceGroupId
                    );
                    if (existingPrice) {
                        await db
                            .update(productDetailPrices)
                            .set({ price: p.price })
                            .where(eq(productDetailPrices.id, existingPrice.id));
                    } else {
                        await db.insert(productDetailPrices).values({
                            productDetailId: detailId,
                            priceGroupId: p.priceGroupId,
                            price: p.price,
                        });
                    }
                }
            }
        }

        // ----- ATTRIBUTES -----
        const existingAttrs = await db
            .select()
            .from(productAttributeValues)
            .where(eq(productAttributeValues.productId, product.id));

        const newAttrs = product.attributes ?? [];
        const attrsToDelete = existingAttrs.filter(
            (ea) => !newAttrs.some((na) => na.attributeId === ea.attributeId),
        );

        if (attrsToDelete.length) {
            await db.delete(productAttributeValues).where(
                inArray(
                    productAttributeValues.attributeId,
                    attrsToDelete.map((a) => a.attributeId),
                ),
            );
        }

        for (const a of newAttrs) {
            const existing = existingAttrs.find(
                (ea) => ea.attributeId === a.attributeId,
            );
            if (existing) {
                await db
                    .update(productAttributeValues)
                    .set({ value: a.value })
                    .where(eq(productAttributeValues.id, existing.id));
            } else {
                await db.insert(productAttributeValues).values({
                    productId: product.id,
                    attributeId: a.attributeId,
                    value: a.value,
                });
            }
        }

        // ----- IMAGES -----
        const oldImages = await db
            .select()
            .from(productImages)
            .where(eq(productImages.productId, product.id));

        const newImages = product.images ?? [];
        const orphanImages = oldImages.filter(
            (oi) => !newImages.some((ni) => ni.filename === oi.filename),
        );

        for (const f of orphanImages) {
            try {
                await fs.promises.unlink(path.join("uploads", f.filename));
            } catch (err) {
                console.warn("Failed delete orphan", f.filename, err);
            }
        }

        if (orphanImages.length) {
            await db.delete(productImages).where(
                inArray(
                    productImages.id,
                    orphanImages.map((i) => i.id),
                ),
            );
        }

        for (const img of newImages) {
            const existing = oldImages.find(
                (oi) => oi.filename === img.filename,
            );
            if (!existing) {
                await db.insert(productImages).values({
                    productId: product.id,
                    url: img.url,
                    filename: img.filename,
                    mimetype: img.mimetype ?? "image/*",
                    size: img.size ?? 0,
                });
            }
        }

        logAction(req, {
            action: "update",
            table: "products",
            oldData: existingDetails, // existingDetails were fetched at line 242
            data: product,
            userId: req.user!.id,
            msg: `updated product #${product.id}`,
        });

        return res.json({ message: "Product updated successfully" });
    } catch (err) {
        console.error("UpdateProduct error:", err);
        return res.status(500).json({
            message: "Internal error",
            error: (err as Error).message,
        });
    }
};

export const getPaginatedProducts = async (req: Request, res: Response) => {
    try {
        const query = req.query;

        const pageIndex = parseInt(query.pageIndex as string) || 0;
        const pageSize = parseInt(query.pageSize as string) || 5;
        const offset = pageIndex * pageSize;

        const search = (query.search as string) ?? "";
        const searchCondition = search
            ? or(
                like(
                    sql`LOWER(${products.name})`,
                    `%${search.toLowerCase()}%`,
                ),
            )
            : undefined;

        const sortColumns: Record<string, PgColumn> = {
            name: products.name,
        };

        const sortKey = (query.sort as string) ?? "name";
        const order = (query.order as string) === "desc" ? "desc" : "asc";

        const sortColumn = sortColumns[sortKey] ?? products.name;

        const [productList, [totalCount]] = await Promise.all([
            db
                .select()
                .from(products)
                .where(searchCondition)
                .orderBy(order === "desc" ? desc(sortColumn) : asc(sortColumn))
                .limit(pageSize)
                .offset(offset),
            db
                .select({ count: sql<number>`count(*)` })
                .from(products)
                .where(searchCondition),
        ]);

        res.json({
            rows: productList,
            pageCount: Math.ceil(Number(totalCount?.count || 0) / pageSize),
            rowCount: Number(totalCount?.count || 0),
            pageIndex,
            pageSize,
            sort: sortKey,
            order,
        });
    } catch (error) {
        console.error("Error fetching products:", error);
        res.status(500).json({ message: "Failed to fetch products" });
    }
};
