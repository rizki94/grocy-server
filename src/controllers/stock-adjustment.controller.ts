import { db } from "@/db";
import {
    journalEntries,
    journals,
    transactionDetails,
    transactions,
} from "@/db/schemas";
import { generateInvoice } from "@/helpers/generate-invoice";
import { updateStockForTransaction } from "@/repositories/stock.repository";
import { purchaseById } from "@/repositories/transaction.repository";
import {
    transactionWithDetailInsertSchema,
    transactionWithDetailUpdateSchema,
} from "@/validators/transaction.validator";
import { logAction } from "@/utils/log-helper";
import { and, desc, eq, gte, lte, or, sql, like } from "drizzle-orm";
import { Request, Response } from "express";
import { parseTableQuery } from "@/services/table-query";
import { PgColumn } from "drizzle-orm/pg-core";
import { findGlAccountByCode } from "@/repositories/gl-account.repository";

export async function getAllAdjustments(req: Request, res: Response) {
    try {
        const data = await db
            .select()
            .from(transactions)
            .where(eq(transactions.type, "adjustment"))
            .orderBy(desc(transactions.date));
        res.status(200).json(data);
    } catch (error) {
        console.error("Error fetching adjustments:", error);
        res.status(500).json({ message: "Failed to fetch adjustments" });
    }
}

export const getAdjustmentById = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const rows = await purchaseById(id);
        if (rows.length === 0) {
            return res.status(404).json({ error: "Adjustment not found" });
        }
        const { transaction } = rows[0];
        const details = rows.filter((r) => r.detail).map((r) => r.detail!);
        res.status(200).json({ ...transaction, details });
    } catch (error) {
        console.error("Error fetching adjustment:", error);
        res.status(500).json({ message: "Failed to fetch adjustment" });
    }
};

export const createAdjustment = async (req: Request, res: Response) => {
    const parsed = transactionWithDetailInsertSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    const adjustment = parsed.data;
    const invoice = await generateInvoice("adjustment");

    try {
        const [created] = await db
            .insert(transactions)
            .values({
                ...adjustment,
                invoice,
                type: "adjustment",
                status: "draft",
                userId: req.user!.id,
            })
            .returning();

        for (const detail of adjustment.details) {
            await db.insert(transactionDetails).values({
                transactionId: created.id,
                ...detail,
            });
        }

        logAction(req, {
            action: "insert",
            table: "transactions",
            data: { ...created, details: adjustment.details },
            userId: req.user!.id,
            msg: `created adjustment #${created.id}`,
        });

        return res
            .status(201)
            .json({ message: "Adjustment created", id: created.id });
    } catch (error) {
        console.error("Create adjustment error:", error);
        return res.status(500).json({ message: "Failed to create adjustment" });
    }
};

export const updateAdjustment = async (req: Request, res: Response) => {
    const parsed = transactionWithDetailUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    const adjustment = parsed.data;
    try {
        const [updated] = await db
            .update(transactions)
            .set({ ...adjustment, updatedAt: new Date() })
            .where(
                and(
                    eq(transactions.id, adjustment.id!),
                    eq(transactions.status, "draft"),
                ),
            )
            .returning();

        const oldData = await db
            .select()
            .from(transactions)
            .where(eq(transactions.id, adjustment.id!))
            .then((r) => r[0]);

        if (!updated) {
            return res.status(400).json({
                message:
                    "Cannot edit posted adjustment or adjustment not found",
            });
        }

        const existingDetails = await db
            .select()
            .from(transactionDetails)
            .where(eq(transactionDetails.transactionId, adjustment.id!));

        // Delete old details and insert new ones (simpler for adjustments)
        await db
            .delete(transactionDetails)
            .where(eq(transactionDetails.transactionId, adjustment.id!));
        for (const detail of adjustment.details) {
            await db.insert(transactionDetails).values({
                transactionId: updated.id,
                ...detail,
            });
        }

        logAction(req, {
            action: "update",
            table: "transactions",
            oldData: { ...oldData, details: existingDetails },
            data: { ...updated, details: adjustment.details },
            userId: req.user!.id,
            msg: `updated adjustment #${updated.id}`,
        });

        return res.status(200).json({ message: "Adjustment updated" });
    } catch (error) {
        console.error("Update adjustment error:", error);
        return res.status(500).json({ message: "Failed to update adjustment" });
    }
};

export const postAdjustment = async (req: Request, res: Response) => {
    const { id } = req.params;
    console.log(`[postAdjustment] Starting for ID: ${id}`);
    try {
        await db.transaction(async (tx) => {
            // Guard: check current status first
            const [existing] = await tx
                .select()
                .from(transactions)
                .where(eq(transactions.id, id));

            if (!existing) throw new Error("Adjustment not found");
            if (existing.status !== "draft") {
                throw new Error(
                    `Adjustment is already ${existing.status} and cannot be posted again`,
                );
            }

            // Guard: check no journal already exists for this transaction
            const [existingJournal] = await tx
                .select()
                .from(journals)
                .where(eq(journals.transactionId, id));

            if (existingJournal) {
                throw new Error(
                    "A journal has already been posted for this adjustment",
                );
            }

            console.log(`[postAdjustment] Updating transaction status...`);
            const [adjustment] = await tx
                .update(transactions)
                .set({ status: "posted", updatedAt: new Date() })
                .where(eq(transactions.id, id))
                .returning();

            if (!adjustment) throw new Error("Failed to update adjustment status");
            console.log(
                `[postAdjustment] Status updated to: ${adjustment.status}`,
            );

            const details = await tx
                .select()
                .from(transactionDetails)
                .where(eq(transactionDetails.transactionId, id));

            console.log(`[postAdjustment] Found ${details.length} details.`);

            // update stock and calculate FIFO cost for OUT items
            console.log(
                `[postAdjustment] Calling updateStockForTransaction...`,
            );
            await updateStockForTransaction(
                id,
                "adjustment",
                details as any,
                tx,
            );
            console.log(`[postAdjustment] Stock updated.`);

            // Fetch updated details with calculated costs
            const updatedDetails = await tx
                .select()
                .from(transactionDetails)
                .where(eq(transactionDetails.transactionId, id));

            // Calculate totals
            const totalIn = updatedDetails
                .filter((d) => d.movementType === 1)
                .reduce((sum, d) => sum + Number(d.totalCost || d.amount), 0);

            const totalOut = updatedDetails
                .filter((d) => d.movementType === -1)
                .reduce((sum, d) => sum + Number(d.totalCost), 0);

            console.log(
                `[postAdjustment] Total IN: ${totalIn}, Total OUT: ${totalOut}`,
            );

            // Create Journal
            const [journal] = await tx
                .insert(journals)
                .values({
                    transactionId: adjustment.id,
                    date: adjustment.date,
                    description: `Stock Adjustment #${adjustment.invoice}`,
                    status: "posted",
                })
                .returning();

            console.log(`[postAdjustment] Journal created: ${journal.id}`);

            const inventoryAccount = await findGlAccountByCode("1400");
            const adjustmentAccount = await findGlAccountByCode("5200"); // Operating Expenses as fallback

            if (!inventoryAccount || !adjustmentAccount) {
                throw new Error("GL Accounts not found (1400 or 5200)");
            }

            // For IN (Add Stock): Dr Inventory, Cr Adjustment (Gain/Expense Reduction)
            if (totalIn > 0) {
                await tx.insert(journalEntries).values({
                    journalId: journal.id,
                    glAccountId: inventoryAccount,
                    debit: totalIn,
                    credit: 0,
                    note: `Stock In (Adjustment #${adjustment.invoice})`,
                });
                await tx.insert(journalEntries).values({
                    journalId: journal.id,
                    glAccountId: adjustmentAccount,
                    debit: 0,
                    credit: totalIn,
                    note: `Stock In (Adjustment #${adjustment.invoice})`,
                });
            }

            // For OUT (Remove Stock): Dr Adjustment (Loss/Expense), Cr Inventory
            if (totalOut > 0) {
                await tx.insert(journalEntries).values({
                    journalId: journal.id,
                    glAccountId: adjustmentAccount,
                    debit: totalOut,
                    credit: 0,
                    note: `Stock Out (Adjustment #${adjustment.invoice})`,
                });
                await tx.insert(journalEntries).values({
                    journalId: journal.id,
                    glAccountId: inventoryAccount,
                    debit: 0,
                    credit: totalOut,
                    note: `Stock Out (Adjustment #${adjustment.invoice})`,
                });
            }
            console.log(`[postAdjustment] Journal entries created.`);
            logAction(req, {
                action: "update",
                table: "transactions",
                data: adjustment,
                userId: req.user!.id,
                msg: `posted adjustment #${adjustment.id}`,
            });
        });

        console.log(`[postAdjustment] Transaction committed successfully.`);
        res.status(200).json({ message: "Adjustment posted successfully" });
    } catch (error: any) {
        console.error("Post adjustment error:", error);
        res.status(500).json({
            message: error.message || "Failed to post adjustment",
        });
    }
};

export const getPaginatedAdjustments = async (req: Request, res: Response) => {
    try {
        const { search, sort, order, pageIndex, pageSize, offset, from, to } =
            parseTableQuery(req.query);

        const searchCondition = search
            ? or(
                like(
                    sql`LOWER(${transactions.invoice})`,
                    `%${search.toLowerCase()}%`,
                ),
                like(
                    sql`LOWER(${transactions.reference})`,
                    `%${search.toLowerCase()}%`,
                ),
            )
            : undefined;

        const dateCondition =
            from && to
                ? and(
                    gte(transactions.date, from.toISOString()),
                    lte(transactions.date, to.toISOString()),
                )
                : undefined;

        const sortColumns: Record<string, PgColumn> = {
            invoice: transactions.invoice,
            date: transactions.date,
        };
        const sortColumn = sortColumns[sort] ?? transactions.date;

        const [list, [totalCount]] = await Promise.all([
            db
                .select()
                .from(transactions)
                .where(
                    and(
                        eq(transactions.type, "adjustment"),
                        searchCondition,
                        dateCondition,
                    ),
                )
                .orderBy(order === "desc" ? desc(sortColumn) : desc(sortColumn))
                .limit(pageSize)
                .offset(offset),
            db
                .select({ count: sql<number>`count(*)` })
                .from(transactions)
                .where(
                    and(
                        eq(transactions.type, "adjustment"),
                        searchCondition,
                        dateCondition,
                    ),
                ),
        ]);

        res.json({
            rows: list,
            pageCount: Math.ceil(Number(totalCount?.count || 0) / pageSize),
            rowCount: Number(totalCount?.count || 0),
            pageIndex,
            pageSize,
        });
    } catch (error) {
        console.error("Error fetching adjustments:", error);
        res.status(500).json({ message: "Failed to fetch adjustments" });
    }
};

export const cancelAdjustment = async (req: Request, res: Response) => {
    const { id } = req.params;
    console.log(`[cancelAdjustment] Starting for ID: ${id}`);
    try {
        await db.transaction(async (tx) => {
            // 1. Get Original Transaction
            const [original] = await tx
                .select()
                .from(transactions)
                .where(eq(transactions.id, id));

            if (!original) throw new Error("Adjustment not found");
            if (original.status !== "posted") {
                throw new Error("Only posted adjustments can be voided");
            }

            // 2. Fetach Original Details
            const originalDetails = await tx
                .select()
                .from(transactionDetails)
                .where(eq(transactionDetails.transactionId, id));

            // 3. Create Reversal Transaction
            const reversalInvoice = await generateInvoice("adjustment");
            const [reversal] = await tx
                .insert(transactions)
                .values({
                    userId: req.user!.id,
                    type: "adjustment",
                    invoice: reversalInvoice,
                    reference: `Void of ${original.invoice}`,
                    date: new Date().toISOString(),
                    status: "posted", // Immediate post for reversal
                    updatedAt: new Date(),
                })
                .returning();

            // 4. Create Reversed Details (Invert Movement Type)
            const reversedDetails = originalDetails.map((detail) => ({
                ...detail,
                transactionId: reversal.id,
                movementType: detail.movementType * -1,
                // Keep unitCost/totalCost for IN (Restoration) logic
            }));

            // Insert Reversed Details into DB
            for (const detail of reversedDetails) {
                await tx.insert(transactionDetails).values({
                    transactionId: reversal.id,
                    productId: detail.productId,
                    productDetailId: detail.productDetailId,
                    baseRatio: detail.baseRatio,
                    qty: detail.qty,
                    price: detail.price,
                    discount: detail.discount,
                    amount: detail.amount,
                    taxRate: detail.taxRate,
                    unitCost: detail.unitCost,
                    totalCost: detail.totalCost,
                    movementType: detail.movementType,
                });
            }

            // 5. Update Stock (Process logic for Reversal)
            console.log(`[cancelAdjustment] Updating stock for reversal...`);
            await updateStockForTransaction(
                reversal.id,
                "adjustment",
                reversedDetails as any,
                tx,
            );

            // Fetch updated reversal details (with calculated costs for OUTs)
            const finalReversalDetails = await tx
                .select()
                .from(transactionDetails)
                .where(eq(transactionDetails.transactionId, reversal.id));

            // 6. Calculate Journal Totals for Reversal
            const totalIn = finalReversalDetails
                .filter((d) => d.movementType === 1)
                .reduce((sum, d) => sum + Number(d.totalCost || d.amount), 0);

            const totalOut = finalReversalDetails
                .filter((d) => d.movementType === -1)
                .reduce((sum, d) => sum + Number(d.totalCost), 0);

            // 7. Create Journal for Reversal
            const [journal] = await tx
                .insert(journals)
                .values({
                    transactionId: reversal.id,
                    date: reversal.date,
                    description: `Void Adjustment #${original.invoice}`,
                    status: "posted",
                })
                .returning();

            const inventoryAccount = await findGlAccountByCode("1400");
            const adjustmentAccount = await findGlAccountByCode("5200");

            if (!inventoryAccount || !adjustmentAccount) {
                throw new Error("GL Accounts not found");
            }

            // Create Journal Entries (Standard Logic, effectively reverses original impact)
            if (totalIn > 0) {
                // Stock In: Debit Inventory, Credit Adjustment
                await tx.insert(journalEntries).values({
                    journalId: journal.id,
                    glAccountId: inventoryAccount,
                    debit: totalIn,
                    credit: 0,
                    note: `Stock In (Void #${original.invoice})`,
                });
                await tx.insert(journalEntries).values({
                    journalId: journal.id,
                    glAccountId: adjustmentAccount,
                    debit: 0,
                    credit: totalIn,
                    note: `Stock In (Void #${original.invoice})`,
                });
            }

            if (totalOut > 0) {
                // Stock Out: Debit Adjustment, Credit Inventory
                await tx.insert(journalEntries).values({
                    journalId: journal.id,
                    glAccountId: adjustmentAccount,
                    debit: totalOut,
                    credit: 0,
                    note: `Stock Out (Void #${original.invoice})`,
                });
                await tx.insert(journalEntries).values({
                    journalId: journal.id,
                    glAccountId: inventoryAccount,
                    debit: 0,
                    credit: totalOut,
                    note: `Stock Out (Void #${original.invoice})`,
                });
            }

            // 8. Mark Original as Cancelled
            await tx
                .update(transactions)
                .set({ status: "cancelled", updatedAt: new Date() })
                .where(eq(transactions.id, id));

            console.log(`[cancelAdjustment] Void complete.`);
            logAction(req, {
                action: "update",
                table: "transactions",
                data: original,
                userId: req.user!.id,
                msg: `voided adjustment #${original.id}`,
            });
        });

        res.status(200).json({ message: "Adjustment voided successfully" });
    } catch (error: any) {
        console.error("Void adjustment error:", error);
        res.status(500).json({
            message: error.message || "Failed to void adjustment",
        });
    }
};
