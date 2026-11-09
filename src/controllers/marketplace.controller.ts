import { db } from "@/db";
import {
    contacts,
    marketplaces,
    marketplaceFeeRules,
    priceGroups,
    products,
    productDetails,
    productDetailPrices,
    productUnits,
    stocks,
    warehouses,
    transactions,
    openInvoices,
    payments,
    paymentLines,
    paymentAccounts,
    glAccounts,
    productAttributes,
    productAttributeValues,
} from "@/db/schemas";
import { and, eq, ilike, inArray, isNotNull, or, sql } from "drizzle-orm";
import { Request, Response } from "express";
import { resolveBranchId } from "@/helpers/branch.helper";
import { postPayment } from "@/repositories/payment.repository";

const DEFAULT_MARKETPLACES = [
    { name: "Shopee", code: "shopee" },
    { name: "TikTok", code: "tiktok" },
    { name: "Tokopedia", code: "tokopedia" },
    { name: "Lazada", code: "lazada" },
    { name: "Blibli", code: "blibli" },
];

export async function ensureDefaultMarketplaces() {
    try {
        const existing = await db.select().from(marketplaces).limit(1);
        if (existing.length === 0) {
            for (const m of DEFAULT_MARKETPLACES) {
                await db
                    .insert(marketplaces)
                    .values({
                        name: m.name,
                        code: m.code,
                        isActive: true,
                    })
                    .onConflictDoNothing();
            }
        }
    } catch (err) {
        console.error("Failed to seed default marketplaces:", err);
    }
}

export const getAllMarketplaces = async (req: Request, res: Response) => {
    try {
        await ensureDefaultMarketplaces();
        const { mappedOnly } = req.query;

        const whereClauses = [eq(marketplaces.isActive, true)];
        if (mappedOnly === "true") {
            whereClauses.push(isNotNull(marketplaces.contactId));
        }

        const data = await db
            .select({
                id: marketplaces.id,
                name: marketplaces.name,
                code: marketplaces.code,
                contactId: marketplaces.contactId,
                contactName: contacts.name,
                priceGroupId: marketplaces.priceGroupId,
                priceGroupName: priceGroups.name,
                categoryAttributeId: marketplaces.categoryAttributeId,
                categoryAttributeName: productAttributes.name,
                isActive: marketplaces.isActive,
                createdAt: marketplaces.createdAt,
                updatedAt: marketplaces.updatedAt,
            })
            .from(marketplaces)
            .leftJoin(contacts, eq(marketplaces.contactId, contacts.id))
            .leftJoin(priceGroups, eq(marketplaces.priceGroupId, priceGroups.id))
            .leftJoin(
                productAttributes,
                eq(marketplaces.categoryAttributeId, productAttributes.id)
            )
            .where(and(...whereClauses))
            .orderBy(marketplaces.name);

        res.status(200).json(data);
    } catch (error) {
        console.error("Error fetching marketplaces:", error);
        res.status(500).json({ message: "Failed to fetch marketplaces" });
    }
};

export const getPaginatedMarketplaces = async (req: Request, res: Response) => {
    try {
        await ensureDefaultMarketplaces();
        const { search = "", pageIndex = "0", pageSize = "10" } = req.query;
        const page = parseInt(pageIndex as string, 10) || 0;
        const limit = parseInt(pageSize as string, 10) || 10;
        const offset = page * limit;

        const searchCondition = search
            ? or(
                  ilike(marketplaces.name, `%${search}%`),
                  ilike(marketplaces.code, `%${search}%`),
                  ilike(contacts.name, `%${search}%`),
                  ilike(priceGroups.name, `%${search}%`)
              )
            : undefined;

        const [countResult] = await db
            .select({ count: sql<number>`count(*)` })
            .from(marketplaces)
            .leftJoin(contacts, eq(marketplaces.contactId, contacts.id))
            .leftJoin(priceGroups, eq(marketplaces.priceGroupId, priceGroups.id))
            .where(searchCondition);

        const rowCount = Number(countResult?.count || 0);

        const rows = await db
            .select({
                id: marketplaces.id,
                name: marketplaces.name,
                code: marketplaces.code,
                contactId: marketplaces.contactId,
                contactName: contacts.name,
                priceGroupId: marketplaces.priceGroupId,
                priceGroupName: priceGroups.name,
                categoryAttributeId: marketplaces.categoryAttributeId,
                categoryAttributeName: productAttributes.name,
                isActive: marketplaces.isActive,
                createdAt: marketplaces.createdAt,
                updatedAt: marketplaces.updatedAt,
            })
            .from(marketplaces)
            .leftJoin(contacts, eq(marketplaces.contactId, contacts.id))
            .leftJoin(priceGroups, eq(marketplaces.priceGroupId, priceGroups.id))
            .leftJoin(
                productAttributes,
                eq(marketplaces.categoryAttributeId, productAttributes.id)
            )
            .where(searchCondition)
            .orderBy(marketplaces.name)
            .limit(limit)
            .offset(offset);

        res.status(200).json({
            rows,
            rowCount,
            pageCount: Math.ceil(rowCount / limit),
        });
    } catch (error) {
        console.error("Error fetching paginated marketplaces:", error);
        res.status(500).json({ message: "Failed to fetch paginated marketplaces" });
    }
};

export const getMarketplaceById = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const [marketplace] = await db
            .select({
                id: marketplaces.id,
                name: marketplaces.name,
                code: marketplaces.code,
                contactId: marketplaces.contactId,
                contactName: contacts.name,
                priceGroupId: marketplaces.priceGroupId,
                priceGroupName: priceGroups.name,
                categoryAttributeId: marketplaces.categoryAttributeId,
                categoryAttributeName: productAttributes.name,
                isActive: marketplaces.isActive,
                createdAt: marketplaces.createdAt,
                updatedAt: marketplaces.updatedAt,
            })
            .from(marketplaces)
            .leftJoin(contacts, eq(marketplaces.contactId, contacts.id))
            .leftJoin(priceGroups, eq(marketplaces.priceGroupId, priceGroups.id))
            .leftJoin(
                productAttributes,
                eq(marketplaces.categoryAttributeId, productAttributes.id)
            )
            .where(eq(marketplaces.id, id));

        if (!marketplace) {
            return res.status(404).json({ message: "Marketplace not found" });
        }

        const fees = await db
            .select()
            .from(marketplaceFeeRules)
            .where(eq(marketplaceFeeRules.marketplaceId, id))
            .orderBy(marketplaceFeeRules.createdAt);

        res.status(200).json({
            ...marketplace,
            fees,
        });
    } catch (error) {
        console.error("Error fetching marketplace:", error);
        res.status(500).json({ message: "Failed to fetch marketplace" });
    }
};

export const createMarketplace = async (req: Request, res: Response) => {
    const { name, code, contactId, priceGroupId, categoryAttributeId } = req.body;
    if (!name || !code) {
        return res.status(400).json({ message: "Name and code are required" });
    }

    try {
        const [created] = await db
            .insert(marketplaces)
            .values({
                name: name.trim(),
                code: code.trim().toLowerCase(),
                contactId: contactId || null,
                priceGroupId: priceGroupId || null,
                categoryAttributeId: categoryAttributeId || null,
                isActive: true,
            })
            .returning();

        res.status(201).json(created);
    } catch (error: any) {
        console.error("Error creating marketplace:", error);
        res.status(500).json({ message: error.message || "Failed to create marketplace" });
    }
};

export const updateMarketplace = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { name, code, contactId, priceGroupId, categoryAttributeId, isActive } = req.body;

    try {
        const [updated] = await db
            .update(marketplaces)
            .set({
                ...(name ? { name: name.trim() } : {}),
                ...(code ? { code: code.trim().toLowerCase() } : {}),
                ...(contactId !== undefined ? { contactId: contactId || null } : {}),
                ...(priceGroupId !== undefined ? { priceGroupId: priceGroupId || null } : {}),
                ...(categoryAttributeId !== undefined ? { categoryAttributeId: categoryAttributeId || null } : {}),
                ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
                updatedAt: new Date(),
            })
            .where(eq(marketplaces.id, id))
            .returning();

        if (!updated) {
            return res.status(404).json({ message: "Marketplace not found" });
        }

        res.status(200).json(updated);
    } catch (error: any) {
        console.error("Error updating marketplace:", error);
        res.status(500).json({ message: error.message || "Failed to update marketplace" });
    }
};

export const deleteMarketplace = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const [deleted] = await db
            .update(marketplaces)
            .set({ isActive: false })
            .where(eq(marketplaces.id, id))
            .returning();

        if (!deleted) {
            return res.status(404).json({ message: "Marketplace not found" });
        }

        res.status(200).json({ message: "Marketplace deactivated successfully" });
    } catch (error: any) {
        console.error("Error deleting marketplace:", error);
        res.status(500).json({ message: error.message || "Failed to delete marketplace" });
    }
};

// ── Product Attributes & Categories Endpoints ─────────────────────────────────

export const getEnumProductAttributes = async (req: Request, res: Response) => {
    try {
        const rows = await db
            .select({
                id: productAttributes.id,
                name: productAttributes.name,
                label: productAttributes.label,
                type: productAttributes.type,
                options: productAttributes.options,
            })
            .from(productAttributes)
            .where(eq(productAttributes.type, "enum"))
            .orderBy(productAttributes.name);

        res.status(200).json(rows);
    } catch (error) {
        console.error("Error fetching enum product attributes:", error);
        res.status(500).json({ message: "Failed to fetch product attributes" });
    }
};

export const getMarketplaceCategories = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        let attributeId: string | null = null;
        let attributeName: string = "Category";
        let options: string[] = [];

        // 1. If marketplace id provided, check its categoryAttributeId
        if (id && id !== "undefined" && id !== "null") {
            const [mp] = await db
                .select({
                    categoryAttributeId: marketplaces.categoryAttributeId,
                })
                .from(marketplaces)
                .where(eq(marketplaces.id, id));

            if (mp?.categoryAttributeId) {
                attributeId = mp.categoryAttributeId;
            }
        }

        // 2. If attributeId found, get its options
        if (attributeId) {
            const [attr] = await db
                .select({
                    id: productAttributes.id,
                    name: productAttributes.name,
                    options: productAttributes.options,
                })
                .from(productAttributes)
                .where(eq(productAttributes.id, attributeId));

            if (attr) {
                attributeName = attr.name;
                options = Array.isArray(attr.options) ? (attr.options as string[]) : [];
            }
        } else {
            // Fallback: Find attribute with name like "category" or "kategori", or first enum attribute
            const [fallbackAttr] = await db
                .select({
                    id: productAttributes.id,
                    name: productAttributes.name,
                    options: productAttributes.options,
                })
                .from(productAttributes)
                .where(
                    or(
                        ilike(productAttributes.name, "%categor%"),
                        ilike(productAttributes.name, "%kategori%")
                    )
                )
                .limit(1);

            if (fallbackAttr) {
                attributeId = fallbackAttr.id;
                attributeName = fallbackAttr.name;
                options = Array.isArray(fallbackAttr.options)
                    ? (fallbackAttr.options as string[])
                    : [];
            } else {
                // If neither, get the first enum attribute
                const [firstEnum] = await db
                    .select({
                        id: productAttributes.id,
                        name: productAttributes.name,
                        options: productAttributes.options,
                    })
                    .from(productAttributes)
                    .where(eq(productAttributes.type, "enum"))
                    .limit(1);

                if (firstEnum) {
                    attributeId = firstEnum.id;
                    attributeName = firstEnum.name;
                    options = Array.isArray(firstEnum.options)
                        ? (firstEnum.options as string[])
                        : [];
                }
            }
        }

        res.status(200).json({
            attributeId,
            attributeName,
            options,
        });
    } catch (error) {
        console.error("Error fetching marketplace categories:", error);
        res.status(500).json({ message: "Failed to fetch categories" });
    }
};

// ── Fee Rules Endpoints ────────────────────────────────────────────────────────

export const getMarketplaceFees = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const fees = await db
            .select()
            .from(marketplaceFeeRules)
            .where(eq(marketplaceFeeRules.marketplaceId, id))
            .orderBy(marketplaceFeeRules.createdAt);

        res.status(200).json(fees);
    } catch (error) {
        console.error("Error fetching fee rules:", error);
        res.status(500).json({ message: "Failed to fetch fee rules" });
    }
};

export const createMarketplaceFee = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { name, type = "percentage", value = 0, category, isActive = true } = req.body;

    if (!name) {
        return res.status(400).json({ message: "Fee name is required" });
    }

    try {
        const [created] = await db
            .insert(marketplaceFeeRules)
            .values({
                marketplaceId: id,
                name: name.trim(),
                type: type === "fixed" ? "fixed" : "percentage",
                value: Number(value) || 0,
                category: category ? String(category).trim() : null,
                isActive: Boolean(isActive),
            })
            .returning();

        res.status(201).json(created);
    } catch (error: any) {
        console.error("Error creating fee rule:", error);
        res.status(500).json({ message: error.message || "Failed to create fee rule" });
    }
};

export const updateMarketplaceFee = async (req: Request, res: Response) => {
    const { feeId } = req.params;
    const { name, type, value, category, isActive } = req.body;

    try {
        const [updated] = await db
            .update(marketplaceFeeRules)
            .set({
                ...(name ? { name: name.trim() } : {}),
                ...(type ? { type: type === "fixed" ? "fixed" : "percentage" } : {}),
                ...(value !== undefined ? { value: Number(value) || 0 } : {}),
                ...(category !== undefined ? { category: category ? String(category).trim() : null } : {}),
                ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
                updatedAt: new Date(),
            })
            .where(eq(marketplaceFeeRules.id, feeId))
            .returning();

        if (!updated) {
            return res.status(404).json({ message: "Fee rule not found" });
        }

        res.status(200).json(updated);
    } catch (error: any) {
        console.error("Error updating fee rule:", error);
        res.status(500).json({ message: error.message || "Failed to update fee rule" });
    }
};

export const deleteMarketplaceFee = async (req: Request, res: Response) => {
    const { feeId } = req.params;
    try {
        await db
            .delete(marketplaceFeeRules)
            .where(eq(marketplaceFeeRules.id, feeId));

        res.status(200).json({ message: "Fee rule deleted successfully" });
    } catch (error: any) {
        console.error("Error deleting fee rule:", error);
        res.status(500).json({ message: error.message || "Failed to delete fee rule" });
    }
};

export const createBatchMarketplaceFees = async (req: Request, res: Response) => {
    const { id } = req.params;
    const {
        name,
        type = "percentage",
        value = 0,
        categories = [],
        replaceExisting = false,
        isActive = true,
    } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({ message: "Nama biaya wajib diisi" });
    }

    if (!Array.isArray(categories) || categories.length === 0) {
        return res.status(400).json({ message: "Pilih setidaknya satu kategori" });
    }

    const numVal = Number(value) || 0;
    const feeType = type === "fixed" ? "fixed" : "percentage";

    try {
        const cleanedCategories = Array.from(
            new Set(categories.map((c: any) => String(c).trim()).filter(Boolean))
        );

        if (replaceExisting && cleanedCategories.length > 0) {
            await db
                .delete(marketplaceFeeRules)
                .where(
                    and(
                        eq(marketplaceFeeRules.marketplaceId, id),
                        inArray(marketplaceFeeRules.category, cleanedCategories)
                    )
                );
        }

        const toInsert = cleanedCategories.map((cat) => ({
            marketplaceId: id,
            name: name.trim(),
            type: feeType as "percentage" | "fixed",
            value: numVal,
            category: cat === "__all__" ? null : cat,
            isActive: Boolean(isActive),
        }));

        const inserted = await db
            .insert(marketplaceFeeRules)
            .values(toInsert)
            .returning();

        res.status(201).json({
            message: `Berhasil menambahkan aturan biaya untuk ${inserted.length} kategori`,
            count: inserted.length,
            fees: inserted,
        });
    } catch (error: any) {
        console.error("Error creating batch marketplace fees:", error);
        res.status(500).json({ message: error.message || "Gagal menyimpan batch aturan biaya" });
    }
};

export const deleteBatchMarketplaceFees = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { feeIds = [], categories = [] } = req.body;

    try {
        const conditions = [eq(marketplaceFeeRules.marketplaceId, id)];

        if (Array.isArray(feeIds) && feeIds.length > 0) {
            conditions.push(inArray(marketplaceFeeRules.id, feeIds));
        } else if (Array.isArray(categories) && categories.length > 0) {
            conditions.push(inArray(marketplaceFeeRules.category, categories));
        } else {
            return res.status(400).json({ message: "Tentukan feeIds atau categories yang akan dihapus" });
        }

        const deleted = await db
            .delete(marketplaceFeeRules)
            .where(and(...conditions))
            .returning();

        res.status(200).json({
            message: `Berhasil menghapus ${deleted.length} aturan biaya`,
            count: deleted.length,
        });
    } catch (error: any) {
        console.error("Error deleting batch marketplace fees:", error);
        res.status(500).json({ message: error.message || "Gagal menghapus aturan biaya" });
    }
};

export const copyMarketplaceFees = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { sourceMarketplaceId, overwrite = false } = req.body;

    if (!sourceMarketplaceId || sourceMarketplaceId === id) {
        return res.status(400).json({ message: "Pilih marketplace sumber yang valid" });
    }

    try {
        const sourceFees = await db
            .select()
            .from(marketplaceFeeRules)
            .where(eq(marketplaceFeeRules.marketplaceId, sourceMarketplaceId));

        if (sourceFees.length === 0) {
            return res.status(400).json({ message: "Marketplace sumber belum memiliki aturan biaya" });
        }

        if (overwrite) {
            await db
                .delete(marketplaceFeeRules)
                .where(eq(marketplaceFeeRules.marketplaceId, id));
        }

        const toInsert = sourceFees.map((f) => ({
            marketplaceId: id,
            name: f.name,
            type: f.type,
            value: f.value,
            category: f.category,
            isActive: f.isActive,
        }));

        const inserted = await db
            .insert(marketplaceFeeRules)
            .values(toInsert)
            .returning();

        res.status(201).json({
            message: `Berhasil menyalin ${inserted.length} aturan biaya`,
            count: inserted.length,
        });
    } catch (error: any) {
        console.error("Error copying marketplace fees:", error);
        res.status(500).json({ message: error.message || "Gagal menyalin aturan biaya" });
    }
};

export const getMarketplaceCategoryMatrix = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const [mp] = await db
            .select({
                categoryAttributeId: marketplaces.categoryAttributeId,
            })
            .from(marketplaces)
            .where(eq(marketplaces.id, id));

        let catAttrId = mp?.categoryAttributeId;
        if (!catAttrId) {
            const [fb] = await db
                .select({ id: productAttributes.id })
                .from(productAttributes)
                .where(
                    or(
                        ilike(productAttributes.name, "%categor%"),
                        ilike(productAttributes.name, "%kategori%")
                    )
                )
                .limit(1);
            if (fb) catAttrId = fb.id;
        }

        let categories: string[] = [];
        if (catAttrId) {
            const [attr] = await db
                .select({ options: productAttributes.options })
                .from(productAttributes)
                .where(eq(productAttributes.id, catAttrId));
            if (attr && Array.isArray(attr.options)) {
                categories = attr.options as string[];
            }
        }

        const allFees = await db
            .select()
            .from(marketplaceFeeRules)
            .where(eq(marketplaceFeeRules.marketplaceId, id));

        const globalFees = allFees.filter(
            (f) => !f.category || f.category === "__all__" || /all|semua|default category/i.test(f.category)
        );

        const categoryFeesMap: Record<string, typeof allFees> = {};
        for (const f of allFees) {
            if (f.category && f.category !== "__all__") {
                const catKey = f.category.trim().toLowerCase();
                if (!categoryFeesMap[catKey]) categoryFeesMap[catKey] = [];
                categoryFeesMap[catKey].push(f);
            }
        }

        let globalPercent = 0;
        let globalFixed = 0;
        for (const gf of globalFees) {
            if (gf.isActive) {
                if (gf.type === "percentage") globalPercent += Number(gf.value || 0);
                else globalFixed += Number(gf.value || 0);
            }
        }

        const matrix = categories.map((catName) => {
            const specificRules = categoryFeesMap[catName.trim().toLowerCase()] || [];
            let catPercent = 0;
            let catFixed = 0;
            for (const sf of specificRules) {
                if (sf.isActive) {
                    if (sf.type === "percentage") catPercent += Number(sf.value || 0);
                    else catFixed += Number(sf.value || 0);
                }
            }

            return {
                category: catName,
                hasSpecificRules: specificRules.length > 0,
                rulesCount: specificRules.length,
                specificRules,
                totalPercentage: globalPercent + catPercent,
                totalFixed: globalFixed + catFixed,
                globalPercentage: globalPercent,
                globalFixed: globalFixed,
            };
        });

        res.status(200).json({
            categoriesTotal: categories.length,
            assignedCount: matrix.filter((m) => m.hasSpecificRules).length,
            unassignedCount: matrix.filter((m) => !m.hasSpecificRules).length,
            globalFees,
            matrix,
        });
    } catch (error: any) {
        console.error("Error fetching category matrix:", error);
        res.status(500).json({ message: error.message || "Failed to fetch category matrix" });
    }
};

// ── Stock & Price Sync Lookup Endpoint ─────────────────────────────────────────

export const getMarketplaceSyncLookup = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { skuList, warehouseId } = req.body;

    try {
        const [mp] = await db
            .select({
                id: marketplaces.id,
                name: marketplaces.name,
                code: marketplaces.code,
                priceGroupId: marketplaces.priceGroupId,
                priceGroupName: priceGroups.name,
                categoryAttributeId: marketplaces.categoryAttributeId,
            })
            .from(marketplaces)
            .leftJoin(priceGroups, eq(marketplaces.priceGroupId, priceGroups.id))
            .where(eq(marketplaces.id, id));

        if (!mp) {
            return res.status(404).json({ message: "Marketplace not found" });
        }

        // Fetch active fee rules for this marketplace
        const fees = await db
            .select()
            .from(marketplaceFeeRules)
            .where(
                and(
                    eq(marketplaceFeeRules.marketplaceId, id),
                    eq(marketplaceFeeRules.isActive, true)
                )
            );

        // Query product details
        const skuArray = Array.isArray(skuList) && skuList.length > 0
            ? skuList.map((s: any) => String(s).trim()).filter(Boolean)
            : undefined;

        const detailsCondition = skuArray
            ? inArray(productDetails.skuId, skuArray)
            : undefined;

        const pDetails = await db
            .select({
                id: productDetails.id,
                skuId: productDetails.skuId,
                barcode: productDetails.barcode,
                productId: productDetails.productId,
                productName: products.name,
                unitName: productUnits.name,
                baseRatio: productDetails.baseRatio,
                cost: productDetails.cost,
            })
            .from(productDetails)
            .innerJoin(products, eq(products.id, productDetails.productId))
            .leftJoin(productUnits, eq(productUnits.id, productDetails.unitId))
            .where(detailsCondition);

        if (pDetails.length === 0) {
            return res.status(200).json({
                marketplace: mp,
                feeSummary: { feePercentSum: 0, feeFixedSum: 0, rulesCount: fees.length },
                items: {},
            });
        }

        const productDetailIds = pDetails.map((d) => d.id);
        const productIds = Array.from(new Set(pDetails.map((d) => d.productId)));

        // Determine which attribute is used for category
        let catAttrId = mp.categoryAttributeId;
        if (!catAttrId) {
            const [fb] = await db
                .select({ id: productAttributes.id })
                .from(productAttributes)
                .where(
                    or(
                        ilike(productAttributes.name, "%categor%"),
                        ilike(productAttributes.name, "%kategori%")
                    )
                )
                .limit(1);
            if (fb) catAttrId = fb.id;
        }

        // Query category values for these products
        const catValues = catAttrId
            ? await db
                  .select({
                      productId: productAttributeValues.productId,
                      value: productAttributeValues.value,
                  })
                  .from(productAttributeValues)
                  .where(
                      and(
                          eq(productAttributeValues.attributeId, catAttrId),
                          inArray(productAttributeValues.productId, productIds)
                      )
                  )
            : [];

        const productCategoryMap: Record<string, string> = {};
        for (const cv of catValues) {
            productCategoryMap[cv.productId] = cv.value;
        }

        // Query Price Group prices if priceGroupId is configured
        const priceMap: Record<string, number> = {};
        if (mp.priceGroupId) {
            const pgPrices = await db
                .select({
                    productDetailId: productDetailPrices.productDetailId,
                    price: productDetailPrices.price,
                })
                .from(productDetailPrices)
                .where(
                    and(
                        eq(productDetailPrices.priceGroupId, mp.priceGroupId),
                        inArray(productDetailPrices.productDetailId, productDetailIds)
                    )
                );

            for (const p of pgPrices) {
                priceMap[p.productDetailId] = Number(p.price || 0);
            }
        }

        // Query stock per product
        const stockConditions = [inArray(stocks.productId, productIds)];
        if (warehouseId && warehouseId !== "all") {
            stockConditions.push(eq(stocks.warehouseId, warehouseId));
        }

        const stockRows = await db
            .select({
                productId: stocks.productId,
                totalQty: sql<number>`COALESCE(SUM(${stocks.qty}), 0)`,
            })
            .from(stocks)
            .where(and(...stockConditions))
            .groupBy(stocks.productId);

        const stockMap: Record<string, number> = {};
        for (const s of stockRows) {
            stockMap[s.productId] = Number(s.totalQty || 0);
        }

        // Build item lookup keyed by SKU with category-specific fee calculation
        const items: Record<string, any> = {};
        for (const d of pDetails) {
            const baseStock = stockMap[d.productId] || 0;
            const ratio = Number(d.baseRatio || 1) || 1;
            const unitStock = Math.max(0, Math.floor(baseStock / ratio));

            // Product's specific category
            const productCat = (productCategoryMap[d.productId] || "").trim();
            const productCatLower = productCat.toLowerCase();

            // Filter fee rules for this specific product:
            // 1. Global rules (where category is null, empty, or "all" / "semua")
            // 2. Category-specific rules (where rule.category matches product category)
            const applicableFees = fees.filter((f) => {
                const feeCat = (f.category || "").trim().toLowerCase();
                if (!feeCat || feeCat === "all" || feeCat === "semua" || feeCat === "default category") {
                    return true;
                }
                return feeCat === productCatLower;
            });

            let itemFeePercentSum = 0;
            let itemFeeFixedSum = 0;
            for (const f of applicableFees) {
                if (f.type === "percentage") {
                    itemFeePercentSum += Number(f.value || 0);
                } else if (f.type === "fixed") {
                    itemFeeFixedSum += Number(f.value || 0);
                }
            }

            // Price calculation: priceGroup price or cost
            const basePrice = priceMap[d.id] ?? Number(d.cost || 0);
            const calculatedPrice = Math.round(
                basePrice * (1 + itemFeePercentSum / 100) + itemFeeFixedSum
            );

            items[d.skuId.toLowerCase()] = {
                sku: d.skuId,
                barcode: d.barcode,
                productName: d.productName,
                unitName: d.unitName,
                category: productCat || "(Tanpa Kategori)",
                stock: unitStock,
                basePrice,
                feePercent: itemFeePercentSum,
                feeFixed: itemFeeFixedSum,
                calculatedPrice,
                appliedRulesCount: applicableFees.length,
            };
        }

        res.status(200).json({
            marketplace: mp,
            feeSummary: {
                rulesCount: fees.length,
            },
            items,
        });
    } catch (error) {
        console.error("Error in sync-lookup:", error);
        res.status(500).json({ message: "Failed to perform sync lookup" });
    }
};

// ── Settlement Reconciliation Endpoints ────────────────────────────────────────

export const matchMarketplaceSettlement = async (req: Request, res: Response) => {
    const { rows = [], marketplaceId } = req.body;

    if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "Rows array is required" });
    }

    try {
        // Collect all possible variants of reference strings to maximize DB query hits
        const refVariants = new Set<string>();
        for (const r of rows) {
            const raw = String(r.invoiceRef || "").trim();
            if (!raw) continue;
            refVariants.add(raw);
            refVariants.add(raw.toLowerCase());
            refVariants.add(raw.toUpperCase());
            const withoutHash = raw.replace(/^#+/, "").trim();
            if (withoutHash) {
                refVariants.add(withoutHash);
                refVariants.add(withoutHash.toLowerCase());
                refVariants.add(withoutHash.toUpperCase());
            }
            const withoutPrefix = raw.replace(/^(order|pesanan|inv)[-_:\s]+/i, "").trim();
            if (withoutPrefix) {
                refVariants.add(withoutPrefix);
                refVariants.add(withoutPrefix.toLowerCase());
            }
        }

        const refsArray = Array.from(refVariants);
        if (refsArray.length === 0) {
            return res.status(400).json({ message: "No valid invoice references provided" });
        }

        // Find transactions where reference or invoice matches
        const conditions = [
            or(
                inArray(transactions.reference, refsArray),
                inArray(transactions.invoice, refsArray)
            ),
        ];

        if (marketplaceId) {
            conditions.push(eq(transactions.marketplaceId, marketplaceId));
        }

        const matchedTxs = await db
            .select({
                id: transactions.id,
                invoice: transactions.invoice,
                reference: transactions.reference,
                date: transactions.date,
                totalAmount: transactions.totalAmount,
                customerName: contacts.name,
                openInvoiceId: openInvoices.id,
                openAmount: openInvoices.amount,
                paidAmount: openInvoices.paidAmount,
                openStatus: openInvoices.status,
            })
            .from(transactions)
            .leftJoin(contacts, eq(transactions.contactId, contacts.id))
            .leftJoin(openInvoices, eq(openInvoices.transactionId, transactions.id))
            .where(and(...conditions));

        // Map by various normalized keys
        const txMap = new Map<string, any>();
        const registerKey = (key: string | null | undefined, tx: any) => {
            if (!key) return;
            const k = key.trim().toLowerCase();
            if (!txMap.has(k)) txMap.set(k, tx);
            const withoutHash = k.replace(/^#+/, "").trim();
            if (!txMap.has(withoutHash)) txMap.set(withoutHash, tx);
            const withoutPrefix = k.replace(/^(order|pesanan|inv)[-_:\s]+/i, "").trim();
            if (!txMap.has(withoutPrefix)) txMap.set(withoutPrefix, tx);
        };

        for (const tx of matchedTxs) {
            registerKey(tx.reference, tx);
            registerKey(tx.invoice, tx);
        }

        // Process matches
        const results = rows.map((row: any) => {
            const rawRef = String(row.invoiceRef || "").trim();
            const lowerRef = rawRef.toLowerCase();
            const noHashRef = lowerRef.replace(/^#+/, "").trim();
            const noPrefixRef = lowerRef.replace(/^(order|pesanan|inv)[-_:\s]+/i, "").trim();

            const matchedTx =
                txMap.get(lowerRef) ||
                txMap.get(noHashRef) ||
                txMap.get(noPrefixRef);

            const payout = Number(row.payoutAmount || 0);

            if (!matchedTx) {
                return {
                    invoiceRef: row.invoiceRef,
                    payoutAmount: payout,
                    status: "not_found",
                    message: "Transaksi / No. Referensi tidak ditemukan di sistem",
                };
            }

            const invoiceTotal = Number(matchedTx.totalAmount || 0);
            const remainingDue = Number(matchedTx.openAmount || invoiceTotal) - Number(matchedTx.paidAmount || 0);
            const feeDeduction = invoiceTotal - payout;

            let status = "ready";
            let message = "Siap direkonsiliasi";

            if (matchedTx.openStatus === "paid" || remainingDue <= 0) {
                status = "already_paid";
                message = "Faktur sudah lunas sebelumnya";
            }

            return {
                invoiceRef: row.invoiceRef,
                transactionId: matchedTx.id,
                invoice: matchedTx.invoice,
                date: matchedTx.date,
                customerName: matchedTx.customerName,
                invoiceTotal,
                payoutAmount: payout,
                feeDeduction,
                remainingDue,
                openInvoiceId: matchedTx.openInvoiceId,
                status,
                message,
            };
        });

        // Compute summary
        const readyCount = results.filter((r) => r.status === "ready").length;
        const totalPayout = results
            .filter((r) => r.status === "ready")
            .reduce((s, r) => s + (r.payoutAmount || 0), 0);
        const totalInvoice = results
            .filter((r) => r.status === "ready")
            .reduce((s, r) => s + (r.invoiceTotal || 0), 0);
        const totalFee = results
            .filter((r) => r.status === "ready")
            .reduce((s, r) => s + (r.feeDeduction || 0), 0);

        res.status(200).json({
            results,
            summary: {
                totalRows: rows.length,
                readyCount,
                alreadyPaidCount: results.filter((r) => r.status === "already_paid").length,
                notFoundCount: results.filter((r) => r.status === "not_found").length,
                totalPayout,
                totalInvoice,
                totalFee,
            },
        });
    } catch (error) {
        console.error("Error matching settlement:", error);
        res.status(500).json({ message: "Failed to match settlement data" });
    }
};

export const processMarketplaceSettlement = async (req: Request, res: Response) => {
    const {
        marketplaceId,
        paymentDate = new Date().toISOString().split("T")[0],
        bankAccountId,
        expenseAccountId,
        items = [],
    } = req.body;

    const validItems = items.filter(
        (i: any) => i.openInvoiceId && Number(i.payoutAmount) > 0
    );

    if (validItems.length === 0) {
        return res.status(400).json({ message: "No valid ready items to settle" });
    }

    try {
        const branchId = await resolveBranchId(null, req);

        // Fetch marketplace contact if available
        let contactId: string | null = null;
        if (marketplaceId) {
            const [mp] = await db
                .select({ contactId: marketplaces.contactId })
                .from(marketplaces)
                .where(eq(marketplaces.id, marketplaceId));
            contactId = mp?.contactId || null;
        }

        const totalPayout = validItems.reduce(
            (sum: number, it: any) => sum + Number(it.payoutAmount || 0),
            0
        );
        const totalInvoice = validItems.reduce(
            (sum: number, it: any) => sum + Number(it.invoiceTotal || 0),
            0
        );

        // 1. Create Payment record in draft status
        const [pmt] = await db
            .insert(payments)
            .values({
                contactId,
                branchId,
                date: paymentDate,
                type: "receivable",
                totalAmount: totalInvoice,
                status: "draft",
                reference: `SETTLE-MP-${Date.now()}`,
                note: `Pelunasan Massal Marketplace (${validItems.length} faktur)`,
            })
            .returning();

        // 2. Insert payment lines for each open invoice
        for (const it of validItems) {
            await db.insert(paymentLines).values({
                paymentId: pmt.id,
                openInvoiceId: it.openInvoiceId,
                amount: it.invoiceTotal,
            });
        }

        // 3. Insert payment accounts (Bank payout + Marketplace Expense Fee)
        if (bankAccountId) {
            await db.insert(paymentAccounts).values({
                paymentId: pmt.id,
                glAccountId: bankAccountId,
                amount: totalPayout,
            });
        }

        const feeDifference = totalInvoice - totalPayout;
        if (expenseAccountId && feeDifference > 0) {
            await db.insert(paymentAccounts).values({
                paymentId: pmt.id,
                glAccountId: expenseAccountId,
                amount: feeDifference,
            });
        }

        // 4. Post payment through core repository (generates GL journal & updates open invoices/transactions)
        await postPayment(pmt.id);

        res.status(200).json({
            message: `Berhasil menyelesaikan pelunasan ${validItems.length} faktur marketplace`,
            paymentId: pmt.id,
            settledCount: validItems.length,
            totalPayout,
            totalInvoice,
        });
    } catch (error: any) {
        console.error("Error processing settlement:", error);
        res.status(500).json({ message: error.message || "Failed to process settlement" });
    }
};
