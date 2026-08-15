import { db } from "@/db";
import {
    productDetails,
    productUnits,
    products,
    transactionDetails,
    transactions,
} from "@/db/schemas";
import { eq } from "drizzle-orm";

export const purchaseById = async (id: string) => {
    return await db
        .select({
            transaction: transactions,
            detail: {
                ...transactionDetails,
                name: products.name,
                unitName: productUnits.name,
            },
        })
        .from(transactions)
        .leftJoin(
            transactionDetails,
            eq(transactions.id, transactionDetails.transactionId)
        )
        .leftJoin(products, eq(transactionDetails.productId, products.id))
        .leftJoin(
            productDetails,
            eq(transactionDetails.productDetailId, productDetails.id)
        )
        .leftJoin(productUnits, eq(productDetails.unitId, productUnits.id))
        .where(eq(transactions.id, id));
};

/**
 * Helper to safely extract details from purchaseById result.
 * A LEFT JOIN returns an all-null "detail" object when no details exist,
 * so we must filter by detail.id to exclude those phantom rows.
 */
export const extractDetails = (
    rows: Awaited<ReturnType<typeof purchaseById>>,
) =>
    rows
        .filter((r) => r.detail?.id != null)
        .map((r) => ({
            ...r.detail!,
            serialNumbers: Array.isArray(r.detail?.serialNumbers)
                ? r.detail.serialNumbers
                : [],
        }));
