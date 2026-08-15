import { db } from "@/db";
import {
    transactionDetails,
    transactions,
} from "@/db/schemas";
import { generateInvoice } from "@/helpers/generate-invoice";
import { updateStockForTransaction } from "@/repositories/stock.repository";
import { purchaseById, extractDetails } from "@/repositories/transaction.repository";
import {
    transferStockWithDetailInsertSchema,
    transferStockWithDetailUpdateSchema,
} from "@/validators/transaction.validator";
import { logAction } from "@/utils/log-helper";
import { and, desc, eq, gte, lte, or, sql, like } from "drizzle-orm";
import { Request, Response } from "express";
import { parseTableQuery } from "@/services/table-query";
import { PgColumn } from "drizzle-orm/pg-core";

export async function getAllTransfers(req: Request, res: Response) {
    try {
        const data = await db
            .select()
            .from(transactions)
            .where(eq(transactions.type, "transfer_stock"))
            .orderBy(desc(transactions.date));
        res.status(200).json(data);
    } catch (error) {
        console.error("Error fetching transfers:", error);
        res.status(500).json({ message: "Failed to fetch transfers" });
    }
}

export const getTransferById = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const rows = await purchaseById(id);
        if (rows.length === 0) {
            return res.status(404).json({ error: "Transfer not found" });
        }
        const { transaction } = rows[0];
        const allDetails = extractDetails(rows);
        
        const outDetails = allDetails.filter(d => d.movementType === -1);
        const inDetails = allDetails.filter(d => d.movementType === 1);
        
        const warehouseOut = outDetails[0]?.warehouseId;
        const warehouseIn = inDetails[0]?.warehouseId;

        res.status(200).json({ 
            ...transaction, 
            warehouseOut,
            warehouseIn,
            details: outDetails 
        });
    } catch (error) {
        console.error("Error fetching transfer:", error);
        res.status(500).json({ message: "Failed to fetch transfer" });
    }
};

export const createTransfer = async (req: Request, res: Response) => {
    const parsed = transferStockWithDetailInsertSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    const transfer = parsed.data;
    const invoice = await generateInvoice("transfer_stock");

    try {
        const [created] = await db
            .insert(transactions)
            .values({
                ...transfer,
                invoice,
                type: "transfer_stock",
                status: "draft",
                userId: req.user!.id,
            })
            .returning();

        for (const detail of transfer.details) {
            // OUT Detail
            await db.insert(transactionDetails).values({
                transactionId: created.id,
                productId: detail.productId,
                productDetailId: detail.productDetailId,
                warehouseId: transfer.warehouseOut,
                baseRatio: detail.baseRatio,
                qty: detail.qty,
                price: 0,
                discount: 0,
                amount: 0,
                unitCost: 0,
                totalCost: 0,
                taxRate: 0,
                movementType: -1,
                batchNumber: detail.batchNumber,
                expiryDate: detail.expiryDate,
                serialNumbers: detail.serialNumbers,
            });
            // IN Detail
            await db.insert(transactionDetails).values({
                transactionId: created.id,
                productId: detail.productId,
                productDetailId: detail.productDetailId,
                warehouseId: transfer.warehouseIn,
                baseRatio: detail.baseRatio,
                qty: detail.qty,
                price: 0,
                discount: 0,
                amount: 0,
                unitCost: 0,
                totalCost: 0,
                taxRate: 0,
                movementType: 1,
                batchNumber: detail.batchNumber,
                expiryDate: detail.expiryDate,
                serialNumbers: detail.serialNumbers,
            });
        }

        logAction(req, {
            action: "insert",
            table: "transactions",
            data: { ...created, details: transfer.details },
            userId: req.user!.id,
            msg: `created stock transfer #${created.id}`,
        });

        res.status(201).json(created);
    } catch (error) {
        console.error("Error creating transfer:", error);
        res.status(500).json({ message: "Failed to create transfer" });
    }
};

export const updateTransfer = async (req: Request, res: Response) => {
    const { id } = req.params;
    const parsed = transferStockWithDetailUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    const transfer = parsed.data;

    try {
        const [existing] = await db
            .select()
            .from(transactions)
            .where(eq(transactions.id, id));

        if (!existing) {
            return res.status(404).json({ error: "Transfer not found" });
        }

        if (existing.status !== "draft") {
            return res.status(400).json({
                error: "Only draft transfers can be edited",
            });
        }

        const [updated] = await db
            .update(transactions)
            .set({
                date: transfer.date,
                reference: transfer.reference,
                note: transfer.note,
                status: transfer.status,
            })
            .where(eq(transactions.id, id))
            .returning();

        await db
            .delete(transactionDetails)
            .where(eq(transactionDetails.transactionId, id));

        for (const detail of transfer.details) {
            await db.insert(transactionDetails).values({
                transactionId: updated.id,
                productId: detail.productId,
                productDetailId: detail.productDetailId,
                warehouseId: transfer.warehouseOut,
                baseRatio: detail.baseRatio,
                qty: detail.qty,
                price: 0,
                discount: 0,
                amount: 0,
                unitCost: 0,
                totalCost: 0,
                taxRate: 0,
                movementType: -1,
                batchNumber: detail.batchNumber,
                expiryDate: detail.expiryDate,
                serialNumbers: detail.serialNumbers,
            });
            await db.insert(transactionDetails).values({
                transactionId: updated.id,
                productId: detail.productId,
                productDetailId: detail.productDetailId,
                warehouseId: transfer.warehouseIn,
                baseRatio: detail.baseRatio,
                qty: detail.qty,
                price: 0,
                discount: 0,
                amount: 0,
                unitCost: 0,
                totalCost: 0,
                taxRate: 0,
                movementType: 1,
                batchNumber: detail.batchNumber,
                expiryDate: detail.expiryDate,
                serialNumbers: detail.serialNumbers,
            });
        }

        logAction(req, {
            action: "update",
            table: "transactions",
            data: { ...updated, details: transfer.details },
            userId: req.user!.id,
            msg: `updated stock transfer #${updated.id}`,
        });

        res.status(200).json(updated);
    } catch (error) {
        console.error("Error updating transfer:", error);
        res.status(500).json({ message: "Failed to update transfer" });
    }
};

export const postTransfer = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        const [transfer] = await db
            .select()
            .from(transactions)
            .where(eq(transactions.id, id));

        if (!transfer) {
            return res.status(404).json({ error: "Transfer not found" });
        }

        if (transfer.status !== "draft") {
            return res.status(400).json({
                error: "Only draft transfers can be posted",
            });
        }

        const details = await db
            .select()
            .from(transactionDetails)
            .where(eq(transactionDetails.transactionId, id));

        if (details.length === 0) {
            return res.status(400).json({
                error: "Transfer must have at least one detail",
            });
        }

        await db.transaction(async (tx) => {
            await tx
                .update(transactions)
                .set({ status: "posted" })
                .where(eq(transactions.id, id));

            const outDetails = details.filter(d => d.movementType === -1);
            const inDetails = details.filter(d => d.movementType === 1);

            // Process OUT
            await updateStockForTransaction(
                id,
                "transfer_stock",
                outDetails as any,
                tx,
            );

            for (let i = 0; i < outDetails.length; i++) {
                const outD = outDetails[i] as any;
                const inD = inDetails.find(d => d.productId === outD.productId && d.productDetailId === outD.productDetailId);
                
                // update out detail with cost
                const unitCost = outD.unitCost || 0;
                const totalCost = unitCost * Number(outD.qty);
                await tx.update(transactionDetails).set({ totalCost, unitCost }).where(eq(transactionDetails.id, outD.id));

                if (inD) {
                    // Update inD in-memory so updateStockForTransaction uses it
                    (inD as any).unitCost = unitCost;
                    
                    // Process IN with exactly the cost we got from OUT
                    await tx.update(transactionDetails).set({ totalCost, unitCost }).where(eq(transactionDetails.id, inD.id));
                }
            }

            // Process IN
            await updateStockForTransaction(
                id,
                "transfer_stock",
                inDetails as any,
                tx,
            );

            // The user explicitly requested not to create journals for this.
            console.log(`[postTransfer] Processed stock movement for #${transfer.id} without creating journals.`);

            logAction(req, {
                action: "update",
                table: "transactions",
                data: transfer,
                userId: req.user!.id,
                msg: `posted stock transfer #${transfer.id}`,
            });
        });

        res.status(200).json({ message: "Transfer posted successfully" });
    } catch (error: any) {
        console.error("Error posting transfer:", error);
        res.status(400).json({ message: error.message || "Failed to post transfer" });
    }
};

export const getPaginatedTransfers = async (req: Request, res: Response) => {
    try {
        const { search, sort, order, pageIndex, pageSize, offset, from, to } =
            parseTableQuery(req.query);

        const status = req.query.status as "draft" | "order" | "posted" | "partial" | "paid" | "cancelled" | undefined;

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

        const statusCondition = status
            ? eq(transactions.status, status)
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
                        eq(transactions.type, "transfer_stock"),
                        searchCondition,
                        dateCondition,
                        statusCondition,
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
                        eq(transactions.type, "transfer_stock"),
                        searchCondition,
                        dateCondition,
                        statusCondition,
                    ),
                ),
        ]);

        res.status(200).json({
            rows: list,
            pageCount: Math.ceil(totalCount.count / pageSize),
            rowCount: totalCount.count,
        });
    } catch (error) {
        console.error("Error fetching paginated transfers:", error);
        res.status(500).json({ message: "Failed to fetch paginated transfers" });
    }
};

export const cancelTransfer = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        await db.transaction(async (tx) => {
            const [transfer] = await tx
                .select()
                .from(transactions)
                .where(eq(transactions.id, id));

            if (!transfer) {
                throw new Error("Transfer not found");
            }

            if (transfer.status === "cancelled") {
                throw new Error("Transfer is already cancelled");
            }

            if (transfer.status === "posted") {
                // REVERSE STOCK
                const details = await tx
                    .select()
                    .from(transactionDetails)
                    .where(eq(transactionDetails.transactionId, id));

                // Separate original OUT (from warehouseOut) and IN (to warehouseIn)
                const originalOut = details.filter(d => d.movementType === -1);
                const originalIn = details.filter(d => d.movementType === 1);

                // 1. Take items OUT of warehouseIn (reverse of original IN)
                // Original movement was 1 (IN). Reversal is -1 (OUT).
                await updateStockForTransaction(
                    id,
                    "transfer_stock",
                    originalIn.map(d => ({ ...d, movementType: -1 })) as any,
                    tx
                );

                // 2. Put items BACK into warehouseOut (reverse of original OUT)
                // Original movement was -1 (OUT). Reversal is 1 (IN).
                // It will use the unitCost that was already stored in transactionDetails.
                await updateStockForTransaction(
                    id,
                    "transfer_stock",
                    originalOut.map(d => ({ ...d, movementType: 1 })) as any,
                    tx
                );
            }

            await tx
                .update(transactions)
                .set({ status: "cancelled", updatedAt: new Date() })
                .where(eq(transactions.id, id));

            logAction(req, {
                action: "update",
                table: "transactions",
                data: transfer,
                userId: req.user!.id,
                msg: `voided transfer #${transfer.id}`,
            });
        });

        res.status(200).json({ message: "Transfer cancelled successfully" });
    } catch (error: any) {
        console.error("Error cancelling transfer:", error);
        res.status(400).json({ message: error.message || "Failed to cancel transfer" });
    }
};
