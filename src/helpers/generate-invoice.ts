import { transactionPrefixes } from "@/constants/transaction.constant";
import { db } from "@/db";
import { transactions } from "@/db/schemas";
import { desc, eq } from "drizzle-orm";

export async function generateInvoice(type: keyof typeof transactionPrefixes) {
    const prefix = transactionPrefixes[type];
    const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");

    const lastTransaction = await db
        .select()
        .from(transactions)
        .where(eq(transactions.type, type))
        .orderBy(desc(transactions.createdAt))
        .limit(1);

    const lastInvoice = lastTransaction[0]?.invoice || "";
    const lastInvoiceParts = lastInvoice.split("-");
    const lastNumberStr = lastInvoiceParts[2] || "0";
    const lastNumber = parseInt(lastNumberStr, 10);
    const nextNumber = isNaN(lastNumber) ? 1 : lastNumber + 1;

    return `${prefix}-${today}-${String(nextNumber).padStart(4, "0")}`;
}
