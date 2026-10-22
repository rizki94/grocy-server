import { db } from "@/db";
import {
    stockOpnames,
    stockOpnameItems,
    stocks,
    transactions,
    transactionDetails,
    journals,
    journalEntries,
    products,
    productDetails,
    warehouses,
    branches,
} from "@/db/schemas";
import {
    eq,
    and,
    inArray,
    sql,
    desc,
    ilike,
    gte,
    lte,
    asc,
} from "drizzle-orm";
import type { Request, Response } from "express";
import { z } from "zod";
import {
    generateInvoice,
    generateJournalInvoice,
} from "@/helpers/generate-invoice";
import { findGlAccountByCode } from "@/repositories/gl-account.repository";
import {
    resolveBranchId,
    resolveBranchCodeFromId,
    branchScope,
} from "@/helpers/branch.helper";
import { logAction } from "@/utils/log-helper";
import { updateStockForTransaction } from "@/repositories/stock.repository";

/* ─────────────────── validation ─────────────────── */

const createStockOpnameSchema = z.object({
    name: z.string().min(1),
    warehouseId: z.string().uuid().optional().nullable(),
    countDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
    note: z.string().optional().nullable(),
    productIds: z.array(z.string().uuid()).optional(),
});

const updatePhysicalSchema = z.object({
    items: z.array(
        z.object({
            id: z.string().uuid(),
            physicalQty: z.number().min(0),
            note: z.string().optional().nullable(),
        }),
    ),
});

/* ─────────────────── GET /stock-opnames/paginated ─────────────────── */

export async function getPaginatedStockOpnames(req: Request, res: Response) {
    try {
        const {
            pageIndex = 0,
            pageSize = 20,
            search = "",
            status = "",
            from,
            to,
            sort = "createdAt",
            order = "desc",
        } = req.query as Record<string, string>;

        const page = Number(pageIndex);
        const size = Number(pageSize);
        const offset = page * size;
        const scope = branchScope(stockOpnames.branchId, req);

        const where = and(
            scope,
            search ? ilike(stockOpnames.name, `%${search}%`) : undefined,
            status ? eq(stockOpnames.status, status as any) : undefined,
            from ? gte(stockOpnames.countDate, from) : undefined,
            to ? lte(stockOpnames.countDate, to) : undefined,
        );

        const sortCol =
            sort === "countDate"
                ? stockOpnames.countDate
                : sort === "name"
                  ? stockOpnames.name
                  : stockOpnames.createdAt;

        const rows = await db.query.stockOpnames.findMany({
            where,
            orderBy: order === "asc" ? asc(sortCol) : desc(sortCol),
            limit: size,
            offset,
            with: {
                warehouse: { columns: { id: true, name: true } },
                branch: { columns: { id: true, name: true, code: true } },
                createdByUser: { columns: { id: true, username: true, displayName: true } },
            },
        });

        const [{ count }] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(stockOpnames)
            .where(where);

        return res.json({ rows, rowCount: count, pageCount: Math.ceil(count / size) });
    } catch (err) {
        console.error("[getPaginatedStockOpnames]", err);
        return res.status(500).json({ message: "Failed to fetch stock opnames" });
    }
}

/* ─────────────────── GET /stock-opnames/:id ─────────────────── */

export async function getStockOpnameById(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const opname = await db.query.stockOpnames.findFirst({
            where: eq(stockOpnames.id, id),
            with: {
                warehouse: true,
                branch: true,
                createdByUser: { columns: { id: true, username: true, displayName: true } },
                completedByUser: { columns: { id: true, username: true, displayName: true } },
                items: {
                    with: {
                        product: {
                            columns: { id: true, name: true },
                        },
                        productDetail: {
                            columns: { id: true, skuId: true, barcode: true },
                            with: {
                                unit: { columns: { id: true, name: true, abbreviation: true } },
                            },
                        },
                        warehouse: {
                            columns: { id: true, name: true },
                        },
                    },
                    orderBy: asc(stockOpnameItems.createdAt),
                },
            },
        });

        if (!opname) return res.status(404).json({ message: "Stock opname not found" });
        return res.json(opname);
    } catch (err) {
        console.error("[getStockOpnameById]", err);
        return res.status(500).json({ message: "Failed to fetch stock opname" });
    }
}

/* ─────────────────── POST /stock-opnames ─────────────────── */

export async function createStockOpname(req: Request, res: Response) {
    try {
        const parsed = createStockOpnameSchema.safeParse(req.body);
        if (!parsed.success)
            return res.status(400).json({ message: "Validation failed", errors: parsed.error.issues });

        const data = parsed.data;
        const branchId = await resolveBranchId(null, req);
        const branchCode = await resolveBranchCodeFromId(branchId);

        // Generate code
        const [lastOpname] = await db
            .select({ code: stockOpnames.code })
            .from(stockOpnames)
            .orderBy(desc(stockOpnames.createdAt))
            .limit(1);

        const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        const lastSeq = lastOpname?.code
            ? parseInt(lastOpname.code.split("-").at(-1) || "0", 10)
            : 0;
        const nextSeq = String(lastSeq + 1).padStart(4, "0");
        const branchPart = branchCode ? `${branchCode.slice(0, 3).toUpperCase()}-` : "";
        const code = `${branchPart}OPN-${todayStr}-${nextSeq}`;

        // Find relevant products
        const targetProducts = await db.query.products.findMany({
            where: and(
                eq(products.isActive, true),
                data.productIds && data.productIds.length > 0
                    ? inArray(products.id, data.productIds)
                    : undefined,
            ),
            with: {
                details: true,
            },
        });

        const targetProductIds = targetProducts.map((p) => p.id);

        // Snapshot current stock rows
        const warehouseFilter = data.warehouseId
            ? eq(stocks.warehouseId, data.warehouseId)
            : undefined;
        const productFilter =
            targetProductIds.length > 0
                ? inArray(stocks.productId, targetProductIds)
                : undefined;

        const stockRows =
            targetProductIds.length > 0
                ? await db
                      .select({
                          id: stocks.id,
                          productId: stocks.productId,
                          warehouseId: stocks.warehouseId,
                          batchNumber: stocks.batchNumber,
                          expiryDate: stocks.expiryDate,
                          qty: stocks.qty,
                      })
                      .from(stocks)
                      .where(and(warehouseFilter, productFilter))
                : [];

        const result = await db.transaction(async (tx) => {
            const [created] = await tx
                .insert(stockOpnames)
                .values({
                    code,
                    name: data.name,
                    branchId,
                    warehouseId: data.warehouseId ?? null,
                    countDate: data.countDate,
                    note: data.note ?? null,
                    status: "draft",
                    createdBy: req.user!.id,
                })
                .returning();

            const itemsToInsert: Array<{
                stockOpnameId: string;
                productId: string;
                productDetailId: string;
                warehouseId: string | null;
                batchNumber: string | null;
                expiryDate: string | null;
                systemQty: number;
                physicalQty: number | null;
                difference: number | null;
                unitCost: number;
            }> = [];

            // For each target product, map existing stock rows, or create a 0-qty baseline row
            for (const prod of targetProducts) {
                const baseDetail =
                    prod.details.find((d) => d.isDefault) ||
                    prod.details.find((d) => d.level === 1) ||
                    prod.details[0];

                if (!baseDetail) continue;

                const matchingStocks = stockRows.filter((s) => s.productId === prod.id);

                if (matchingStocks.length > 0) {
                    for (const st of matchingStocks) {
                        itemsToInsert.push({
                            stockOpnameId: created.id,
                            productId: prod.id,
                            productDetailId: baseDetail.id,
                            warehouseId: st.warehouseId ?? data.warehouseId ?? null,
                            batchNumber: st.batchNumber ?? null,
                            expiryDate: st.expiryDate ? String(st.expiryDate) : null,
                            systemQty: Number(st.qty),
                            physicalQty: null,
                            difference: null,
                            unitCost: Number(baseDetail.cost || 0),
                        });
                    }
                } else {
                    itemsToInsert.push({
                        stockOpnameId: created.id,
                        productId: prod.id,
                        productDetailId: baseDetail.id,
                        warehouseId: data.warehouseId ?? null,
                        batchNumber: null,
                        expiryDate: null,
                        systemQty: 0,
                        physicalQty: null,
                        difference: null,
                        unitCost: Number(baseDetail.cost || 0),
                    });
                }
            }

            if (itemsToInsert.length > 0) {
                await tx.insert(stockOpnameItems).values(itemsToInsert as any);
            }

            return created;
        });

        logAction(req, {
            action: "insert",
            table: "stock_opnames",
            id: code,
            userId: req.user?.id,
            msg: `Created stock opname ${code} (${data.name})`,
            data: result,
        });

        return res.status(201).json({ message: "Stock opname created", id: result.id, code });
    } catch (err) {
        console.error("[createStockOpname]", err);
        return res.status(500).json({ message: "Failed to create stock opname" });
    }
}

/* ─────────────────── PUT /stock-opnames/:id/items ─────────────────── */

export async function updateStockOpnameItems(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const parsed = updatePhysicalSchema.safeParse(req.body);
        if (!parsed.success)
            return res.status(400).json({ message: "Validation failed", errors: parsed.error.issues });

        const [opname] = await db
            .select()
            .from(stockOpnames)
            .where(eq(stockOpnames.id, id));

        if (!opname) return res.status(404).json({ message: "Stock opname not found" });
        if (opname.status === "completed" || opname.status === "cancelled")
            return res.status(400).json({ message: "Cannot edit a completed or cancelled stock opname" });

        if (opname.status === "draft") {
            await db
                .update(stockOpnames)
                .set({ status: "in_progress", updatedAt: new Date() })
                .where(eq(stockOpnames.id, id));
        }

        for (const item of parsed.data.items) {
            const [existingItem] = await db
                .select()
                .from(stockOpnameItems)
                .where(eq(stockOpnameItems.id, item.id));

            if (!existingItem) continue;

            const difference = item.physicalQty - Number(existingItem.systemQty);
            await db
                .update(stockOpnameItems)
                .set({
                    physicalQty: item.physicalQty,
                    difference,
                    note: item.note ?? null,
                    updatedAt: new Date(),
                })
                .where(eq(stockOpnameItems.id, item.id));
        }

        return res.json({ message: "Stock opname items updated" });
    } catch (err) {
        console.error("[updateStockOpnameItems]", err);
        return res.status(500).json({ message: "Failed to update items" });
    }
}

/* ─────────────────── POST /stock-opnames/:id/complete ─────────────────── */

export async function completeStockOpname(req: Request, res: Response) {
    try {
        const { id } = req.params;

        const opname = await db.query.stockOpnames.findFirst({
            where: eq(stockOpnames.id, id),
            with: {
                items: {
                    with: {
                        product: true,
                        productDetail: true,
                    },
                },
            },
        });

        if (!opname) return res.status(404).json({ message: "Stock opname not found" });
        if (opname.status === "completed")
            return res.status(400).json({ message: "Already completed" });
        if (opname.status === "cancelled")
            return res.status(400).json({ message: "Cannot complete a cancelled opname" });

        const unset = opname.items.filter((i) => i.physicalQty === null || i.physicalQty === undefined);
        if (unset.length > 0)
            return res.status(400).json({
                message: `${unset.length} item(s) do not have physical count entered yet.`,
            });

        const itemsWithDiff = opname.items.filter(
            (i) => i.difference !== null && Number(i.difference) !== 0,
        );

        const branchId = opname.branchId ?? (await resolveBranchId(null, req));
        const branchCode = await resolveBranchCodeFromId(branchId);

        await db.transaction(async (tx) => {
            let adjustmentTransactionId: string | null = null;

            if (itemsWithDiff.length > 0) {
                const adjInvoice = await generateInvoice("adjustment", branchCode);

                const [adjTx] = await tx
                    .insert(transactions)
                    .values({
                        type: "adjustment",
                        invoice: adjInvoice,
                        date: opname.countDate,
                        branchId,
                        reference: opname.code,
                        note: `Auto-generated from Stock Opname ${opname.code}`,
                        status: "posted",
                        userId: req.user!.id,
                        subtotal: 0,
                        totalAmount: 0,
                        totalDiscount: 0,
                        totalTax: 0,
                    })
                    .returning();

                adjustmentTransactionId = adjTx.id;

                const detailsToInsert = itemsWithDiff.map((item) => ({
                    transactionId: adjTx.id,
                    productId: item.productId,
                    productDetailId: item.productDetailId,
                    warehouseId: item.warehouseId ?? opname.warehouseId ?? null,
                    movementType: Number(item.difference) > 0 ? 1 : -1,
                    qty: Math.abs(Number(item.difference)),
                    baseRatio: 1,
                    price: Number(item.unitCost),
                    discount: 0,
                    amount: Math.abs(Number(item.difference)) * Number(item.unitCost),
                    unitCost: Number(item.unitCost),
                    totalCost: Math.abs(Number(item.difference)) * Number(item.unitCost),
                    taxRate: 0,
                    batchNumber: item.batchNumber ?? null,
                    expiryDate: item.expiryDate ? String(item.expiryDate) : null,
                }));

                await tx.insert(transactionDetails).values(detailsToInsert);

                await updateStockForTransaction(
                    adjTx.id,
                    "adjustment",
                    detailsToInsert as any,
                    tx,
                );

                const updatedDetails = await tx
                    .select()
                    .from(transactionDetails)
                    .where(eq(transactionDetails.transactionId, adjTx.id));

                const totalIn = updatedDetails
                    .filter((d) => d.movementType === 1)
                    .reduce((s, d) => s + Number(d.totalCost || d.amount), 0);
                const totalOut = updatedDetails
                    .filter((d) => d.movementType === -1)
                    .reduce((s, d) => s + Number(d.totalCost), 0);

                const journalInvoice = await generateJournalInvoice("adjustment", branchCode);
                const [journal] = await tx
                    .insert(journals)
                    .values({
                        invoice: journalInvoice,
                        transactionId: adjTx.id,
                        branchId,
                        date: opname.countDate,
                        description: `Penyesuaian Stok Opname ${opname.code}`,
                        status: "posted",
                    })
                    .returning();

                const inventoryAccount = await findGlAccountByCode("1400");
                const adjustmentAccount = await findGlAccountByCode("5200");

                if (!inventoryAccount || !adjustmentAccount) {
                    throw new Error("GL Accounts not found (1400 or 5200)");
                }

                if (totalIn > 0) {
                    await tx.insert(journalEntries).values([
                        {
                            journalId: journal.id,
                            glAccountId: inventoryAccount,
                            debit: totalIn,
                            credit: 0,
                            note: `Stock Opname IN ${opname.code}`,
                        },
                        {
                            journalId: journal.id,
                            glAccountId: adjustmentAccount,
                            debit: 0,
                            credit: totalIn,
                            note: `Stock Opname IN ${opname.code}`,
                        },
                    ]);
                }

                if (totalOut > 0) {
                    await tx.insert(journalEntries).values([
                        {
                            journalId: journal.id,
                            glAccountId: adjustmentAccount,
                            debit: totalOut,
                            credit: 0,
                            note: `Stock Opname OUT ${opname.code}`,
                        },
                        {
                            journalId: journal.id,
                            glAccountId: inventoryAccount,
                            debit: 0,
                            credit: totalOut,
                            note: `Stock Opname OUT ${opname.code}`,
                        },
                    ]);
                }
            }

            await tx
                .update(stockOpnames)
                .set({
                    status: "completed",
                    adjustmentTransactionId,
                    completedBy: req.user!.id,
                    completedAt: new Date(),
                    updatedAt: new Date(),
                })
                .where(eq(stockOpnames.id, id));
        });

        logAction(req, {
            action: "update",
            table: "stock_opnames",
            id: opname.code,
            userId: req.user?.id,
            msg: `Completed stock opname ${opname.code}`,
        });

        return res.json({ message: "Stock opname completed and adjustment created" });
    } catch (err) {
        console.error("[completeStockOpname]", err);
        return res.status(500).json({ message: "Failed to complete stock opname" });
    }
}

/* ─────────────────── POST /stock-opnames/:id/cancel ─────────────────── */

export async function cancelStockOpname(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const [opname] = await db
            .select()
            .from(stockOpnames)
            .where(eq(stockOpnames.id, id));

        if (!opname) return res.status(404).json({ message: "Stock opname not found" });
        if (opname.status === "completed")
            return res.status(400).json({ message: "Cannot cancel a completed stock opname" });
        if (opname.status === "cancelled")
            return res.status(400).json({ message: "Already cancelled" });

        await db
            .update(stockOpnames)
            .set({ status: "cancelled", updatedAt: new Date() })
            .where(eq(stockOpnames.id, id));

        logAction(req, {
            action: "update",
            table: "stock_opnames",
            id: opname.code,
            userId: req.user?.id,
            msg: `Cancelled stock opname ${opname.code}`,
        });

        return res.json({ message: "Stock opname cancelled" });
    } catch (err) {
        console.error("[cancelStockOpname]", err);
        return res.status(500).json({ message: "Failed to cancel stock opname" });
    }
}

/* ─────────────────── DELETE /stock-opnames/:id ─────────────────── */

export async function deleteStockOpname(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const [opname] = await db
            .select()
            .from(stockOpnames)
            .where(eq(stockOpnames.id, id));

        if (!opname) return res.status(404).json({ message: "Not found" });
        if (opname.status !== "draft")
            return res.status(400).json({ message: "Only draft stock opnames can be deleted" });

        await db.delete(stockOpnames).where(eq(stockOpnames.id, id));

        logAction(req, {
            action: "delete",
            table: "stock_opnames",
            id: opname.code,
            userId: req.user?.id,
            msg: `Deleted stock opname ${opname.code}`,
        });

        return res.json({ message: "Deleted" });
    } catch (err) {
        console.error("[deleteStockOpname]", err);
        return res.status(500).json({ message: "Failed to delete" });
    }
}
