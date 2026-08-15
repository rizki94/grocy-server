import { TransactionType } from "@/constants/transaction.constant";
import { db } from "@/db";
import {
    products,
    stockLayers,
    stockMovements,
    stocks,
    transactions,
    transactionDetails,
    settings,
    stockSerialNumbers,
} from "@/db/schemas";
import { sql, eq, and, gt, asc, inArray, isNull } from "drizzle-orm";

export async function updateStockForTransaction(
    transactionId: string,
    transactionType: TransactionType,
    details: {
        productId: string;
        warehouseId?: string | null;
        qty: number;
        baseRatio: number;
        movementType: number;
        unitCost?: number;
        batchNumber?: string | null;
        expiryDate?: string | null;
        serialNumbers?: string[] | null;
        serialNumber?: string | null; // For single unit movements
    }[],
    tx?: any, // Optional transaction context
) {
    const run = async (tx: any) => {
        const globalSettings = await tx.select().from(settings).where(eq(settings.id, "global")).limit(1).then((r: any[]) => r[0]);
        const allowNegativeStock = globalSettings?.allowNegativeStock || false;

        for (const detail of details) {
            const baseQty = detail.qty * detail.baseRatio;

            const stockWhere = [
                eq(stocks.productId, detail.productId),
            ];
            
            if (detail.warehouseId) {
                stockWhere.push(eq(stocks.warehouseId, detail.warehouseId));
            } else {
                stockWhere.push(isNull(stocks.warehouseId));
            }

            if (detail.batchNumber) {
                stockWhere.push(eq(stocks.batchNumber, detail.batchNumber));
            } else {
                stockWhere.push(isNull(stocks.batchNumber));
            }

            let [stock] = await tx
                .select()
                .from(stocks)
                .where(and(...stockWhere)) || [];

            if (!stock) {
                const [inserted] = await tx
                    .insert(stocks)
                    .values({
                        productId: detail.productId,
                        warehouseId: detail.warehouseId,
                        batchNumber: detail.batchNumber,
                        expiryDate: detail.expiryDate,
                        qty: 0,
                    })
                    .returning();
                stock = inserted!;
            }

            const isIn = detail.movementType === 1;
            const isOut = detail.movementType === -1;

            if (isIn) {
                const baseRatio = detail.baseRatio && Number(detail.baseRatio) > 0 ? Number(detail.baseRatio) : 1;
                const rawCost =
                    transactionType === "sales_return"
                        ? (detail.unitCost ?? 0)
                        : ["purchase", "sales", "pos_sales", "transfer_stock", "adjustment"].includes(transactionType)
                            ? (detail.unitCost ?? 0)
                            : 0;
                const effectiveCostPerBaseUnit = rawCost / baseRatio;

                const [movement] = await tx
                    .insert(stockMovements)
                    .values({
                        stockId: stock.id,
                        transactionId,
                        qty: baseQty,
                        type: "IN",
                        unitCost: effectiveCostPerBaseUnit,
                        batchNumber: detail.batchNumber,
                        expiryDate: detail.expiryDate,
                        serialNumber: detail.serialNumber,
                    })
                    .returning();

                // Handle Serial Numbers IN
                if (detail.serialNumbers && detail.serialNumbers.length > 0) {
                    for (const sn of detail.serialNumbers) {
                        await tx.insert(stockSerialNumbers).values({
                            productId: detail.productId,
                            warehouseId: detail.warehouseId!,
                            serialNumber: sn,
                            status: "available",
                            transactionId,
                        }).onConflictDoUpdate({
                            target: stockSerialNumbers.serialNumber,
                            set: { status: "available", warehouseId: detail.warehouseId!, transactionId }
                        });
                    }
                } else if (detail.serialNumber) {
                    await tx.insert(stockSerialNumbers).values({
                        productId: detail.productId,
                        warehouseId: detail.warehouseId!,
                        serialNumber: detail.serialNumber,
                        status: "available",
                        transactionId,
                    }).onConflictDoUpdate({
                        target: stockSerialNumbers.serialNumber,
                        set: { status: "available", warehouseId: detail.warehouseId!, transactionId }
                    });
                }

                await tx.insert(stockLayers).values({
                    stockId: stock.id,
                    movementId: movement.id,
                    remainingQty: baseQty,
                    unitCost: effectiveCostPerBaseUnit,
                });

                await tx
                    .update(stocks)
                    .set({ qty: sql`${stocks.qty} + ${baseQty}` })
                    .where(eq(stocks.id, stock.id));
            }

            if (isOut) {
                let remaining = baseQty;
                const layers = await tx
                    .select()
                    .from(stockLayers)
                    .where(
                        and(
                            eq(stockLayers.stockId, stock.id),
                            gt(stockLayers.remainingQty, 0),
                        ),
                    )
                    .orderBy(asc(stockLayers.createdAt));

                let totalCost = 0;
                let totalUsedQty = 0;

                for (const layer of layers) {
                    if (remaining <= 0) break;

                    const usedQty = Math.min(layer.remainingQty, remaining);
                    remaining -= usedQty;
                    totalCost += usedQty * layer.unitCost;
                    totalUsedQty += usedQty;

                    await tx
                        .update(stockLayers)
                        .set({ remainingQty: layer.remainingQty - usedQty })
                        .where(eq(stockLayers.id, layer.id));
                }

                if (remaining > 0) {
                    const [product] = await tx
                        .select({ name: products.name })
                        .from(products)
                        .where(eq(products.id, detail.productId));
                    
                    if (!allowNegativeStock) {
                        throw new Error(
                            `Insufficient stock for product: ${product?.name || detail.productId}`,
                        );
                    } else {
                        // Allow negative stock: use detail.unitCost per base unit for the missing quantity
                        const baseRatio = detail.baseRatio && Number(detail.baseRatio) > 0 ? Number(detail.baseRatio) : 1;
                        const fallbackCostPerBaseUnit = (detail.unitCost || 0) / baseRatio;
                        totalCost += remaining * fallbackCostPerBaseUnit;
                        totalUsedQty += remaining;
                        remaining = 0;
                    }
                }

                const avgCost = totalUsedQty > 0 ? totalCost / totalUsedQty : 0;

                const [movement] = await tx.insert(stockMovements).values({
                    stockId: stock.id,
                    transactionId,
                    qty: -baseQty,
                    type: "OUT",
                    unitCost: avgCost,
                    batchNumber: detail.batchNumber,
                    expiryDate: detail.expiryDate,
                    serialNumber: detail.serialNumber,
                }).returning();

                // Handle Serial Numbers OUT
                // Determine if this OUT movement is a void/cancellation reversal
                const [txRow] = await tx
                    .select({ status: transactions.status })
                    .from(transactions)
                    .where(eq(transactions.id, transactionId))
                    .limit(1);
                const serialOutStatus = txRow?.status === "cancelled" ? "voided" : "sold";

                if (detail.serialNumbers && detail.serialNumbers.length > 0) {
                    await tx.update(stockSerialNumbers)
                        .set({ status: serialOutStatus, transactionId })
                        .where(and(
                            eq(stockSerialNumbers.productId, detail.productId),
                            inArray(stockSerialNumbers.serialNumber, detail.serialNumbers)
                        ));
                } else if (detail.serialNumber) {
                    await tx.update(stockSerialNumbers)
                        .set({ status: serialOutStatus, transactionId })
                        .where(and(
                            eq(stockSerialNumbers.productId, detail.productId),
                            eq(stockSerialNumbers.serialNumber, detail.serialNumber)
                        ));
                }

                await tx
                    .update(stocks)
                    .set({ qty: sql`${stocks.qty} - ${baseQty}` })
                    .where(eq(stocks.id, stock.id));

                // update cost for sales + purchase_return + adjustment
                if (
                    ["sales", "pos_sales", "purchase_return", "adjustment"].includes(
                        transactionType,
                    )
                ) {
                    await tx
                        .update(transactionDetails)
                        .set({
                            unitCost: avgCost,
                            totalCost: avgCost * detail.qty,
                        })
                        .where(
                            and(
                                eq(
                                    transactionDetails.transactionId,
                                    transactionId,
                                ),
                                eq(
                                    transactionDetails.productId,
                                    detail.productId,
                                ),
                            ),
                        );
                }

                if (transactionType === "transfer_stock") {
                    detail.unitCost = avgCost;
                }
            }
        }
    };

    if (tx) {
        return run(tx);
    } else {
        return db.transaction(run);
    }
}
