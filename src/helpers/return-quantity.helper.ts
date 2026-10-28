import { db } from "@/db";
import { transactionDetails, transactions } from "@/db/schemas";
import { and, eq, inArray, ne } from "drizzle-orm";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type ReturnType = "sales_return" | "purchase_return";
type SourceType = "sales" | "purchase";

type ReturnQuantityDetail = {
    productId: string;
    warehouseId: string | null;
    batchNumber: string | null;
    qty: number;
    baseRatio: number;
};

function getItemKey(detail: {
    productId: string;
    batchNumber: string | null;
}) {
    return JSON.stringify([detail.productId, detail.batchNumber]);
}

export async function validateReturnQuantities(
    tx: DbTransaction,
    returnId: string,
    sourceId: string | null,
    sourceType: SourceType,
    returnType: ReturnType,
    requestedDetails: ReturnQuantityDetail[],
) {
    if (!sourceId) {
        throw new Error("A source invoice is required for this return");
    }

    const [source] = await tx
        .select({
            id: transactions.id,
            type: transactions.type,
            status: transactions.status,
        })
        .from(transactions)
        .where(eq(transactions.id, sourceId))
        .for("update");

    if (!source || source.type !== sourceType) {
        throw new Error("The source invoice for this return was not found");
    }

    if (!["posted", "partial", "paid"].includes(source.status)) {
        throw new Error("Only posted source invoices can be returned");
    }

    const sourceDetails = await tx
        .select({
            productId: transactionDetails.productId,
            warehouseId: transactionDetails.warehouseId,
            batchNumber: transactionDetails.batchNumber,
            qty: transactionDetails.qty,
            baseRatio: transactionDetails.baseRatio,
        })
        .from(transactionDetails)
        .where(eq(transactionDetails.transactionId, sourceId));

    const returnedDetails = await tx
        .select({
            productId: transactionDetails.productId,
            warehouseId: transactionDetails.warehouseId,
            batchNumber: transactionDetails.batchNumber,
            qty: transactionDetails.qty,
            baseRatio: transactionDetails.baseRatio,
        })
        .from(transactionDetails)
        .innerJoin(
            transactions,
            eq(transactions.id, transactionDetails.transactionId),
        )
        .where(
            and(
                eq(transactions.parentId, sourceId),
                eq(transactions.type, returnType),
                inArray(transactions.status, ["posted", "partial", "paid"]),
                ne(transactions.id, returnId),
            ),
        );

    const sourceQuantities = new Map<string, number>();
    for (const detail of sourceDetails) {
        const key = getItemKey(detail);
        sourceQuantities.set(
            key,
            (sourceQuantities.get(key) ?? 0) +
                Number(detail.qty) * Number(detail.baseRatio),
        );
    }

    const returnedQuantities = new Map<string, number>();
    for (const detail of returnedDetails) {
        const key = getItemKey(detail);
        returnedQuantities.set(
            key,
            (returnedQuantities.get(key) ?? 0) +
                Number(detail.qty) * Number(detail.baseRatio),
        );
    }

    const requestedQuantities = new Map<string, number>();
    for (const detail of requestedDetails) {
        const quantity = Number(detail.qty);
        const ratio = Number(detail.baseRatio);
        if (
            !Number.isFinite(quantity) ||
            quantity <= 0 ||
            !Number.isFinite(ratio) ||
            ratio <= 0
        ) {
            throw new Error(
                "Return quantities and unit ratios must be greater than zero",
            );
        }

        const key = getItemKey(detail);
        requestedQuantities.set(
            key,
            (requestedQuantities.get(key) ?? 0) + quantity * ratio,
        );
    }

    for (const [key, requestedQuantity] of requestedQuantities) {
        const sourceQuantity = sourceQuantities.get(key);
        if (sourceQuantity === undefined) {
            throw new Error("A return item does not match the source invoice");
        }

        const alreadyReturned = returnedQuantities.get(key) ?? 0;
        if (alreadyReturned + requestedQuantity > sourceQuantity + 0.000001) {
            throw new Error(
                `Return quantity exceeds the remaining quantity on the source invoice (already returned ${alreadyReturned}, requested ${requestedQuantity}, original ${sourceQuantity})`,
            );
        }
    }
}
