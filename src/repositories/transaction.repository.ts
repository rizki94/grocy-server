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
