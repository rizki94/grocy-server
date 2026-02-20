import { TransactionType } from "@/constants/transaction.constant";
import { db } from "@/db";
import {
    products,
    stockLayers,
    stockMovements,
    stocks,
    transactionDetails,
} from "@/db/schemas";
import { sql, eq, and, gt, asc } from "drizzle-orm";

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
    }[],
    tx?: any, // Optional transaction context
) {
    const run = async (tx: any) => {
        for (const detail of details) {
            const baseQty = detail.qty * detail.baseRatio;

            let [stock] =
                (await tx
                    .select()
                    .from(stocks)
                    .where(
                        detail.warehouseId
                            ? and(eq(stocks.productId, detail.productId), eq(stocks.warehouseId, detail.warehouseId))
                            : eq(stocks.productId, detail.productId)
                    )) || [];

            if (!stock) {
                const [inserted] = await tx
                    .insert(stocks)
                    .values({
                        productId: detail.productId,
                        warehouseId: detail.warehouseId,
                        qty: 0,
                    })
                    .returning();
                stock = inserted!;
            }

            const isIn = detail.movementType === 1;
            const isOut = detail.movementType === -1;

            if (isIn) {
                const effectiveCost =
                    transactionType === "sales_return"
                        ? (detail.unitCost ?? 0)
                        : transactionType === "transfer_stock"
                            ? (detail.unitCost ?? 0)
                            : transactionType === "adjustment"
                                ? (detail.unitCost ?? 0)
                                : transactionType === "purchase"
                                    ? (detail.unitCost ?? 0)
                                    : 0;

                const [movement] = await tx
                    .insert(stockMovements)
                    .values({
                        stockId: stock.id,
                        transactionId,
                        qty: baseQty,
                        type: "IN",
                        unitCost: effectiveCost,
                    })
                    .returning();

                await tx.insert(stockLayers).values({
                    stockId: stock.id,
                    movementId: movement.id,
                    remainingQty: baseQty,
                    unitCost: effectiveCost,
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
                    throw new Error(
                        `Insufficient stock for product: ${product?.name || detail.productId
                        }`,
                    );
                }

                const avgCost = totalUsedQty > 0 ? totalCost / totalUsedQty : 0;

                await tx.insert(stockMovements).values({
                    stockId: stock.id,
                    transactionId,
                    qty: -baseQty,
                    type: "OUT",
                    unitCost: avgCost,
                });

                await tx
                    .update(stocks)
                    .set({ qty: sql`${stocks.qty} - ${baseQty}` })
                    .where(eq(stocks.id, stock.id));

                // update cost for sales + purchase_return + adjustment
                if (
                    ["sales", "purchase_return", "adjustment"].includes(
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
