import { transactionPrefixes } from "@/constants/transaction.constant";
import { db } from "@/db";
import { settings, transactions } from "@/db/schemas";
import { desc, eq } from "drizzle-orm";

const prefixKeyMap: Record<keyof typeof transactionPrefixes, keyof typeof settings.$inferSelect> = {
    purchase: "purchasePrefix",
    sales: "salesPrefix",
    sales_return: "salesReturnPrefix",
    purchase_return: "purchaseReturnPrefix",
    transfer_stock: "transferStockPrefix",
    adjustment: "adjustmentPrefix",
    pos_sales: "posSalesPrefix",
};

/**
 * Generates a unique invoice number.
 * Format: [BRANCH-]PREFIX-YYYYMMDD-NNNN
 * e.g. "JKT-SLS-20261021-0001" or "SLS-20261021-0001" (without branch code)
 */
export async function generateInvoice(
    type: keyof typeof transactionPrefixes,
    branchCode?: string | null,
) {
    let prefix = transactionPrefixes[type];

    try {
        const globalSettings = await db.query.settings.findFirst({
            where: eq(settings.id, "global"),
        });
        const key = prefixKeyMap[type];
        if (globalSettings && key && (globalSettings as any)[key]) {
            prefix = (globalSettings as any)[key];
        }
    } catch (e) {
        // Fall back to default constant prefix if error
    }

    const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");

    // Normalize branch code: max 3 chars, uppercase
    const normalizedCode = branchCode
        ? branchCode.trim().toUpperCase().slice(0, 3)
        : null;

    const lastTransaction = await db
        .select()
        .from(transactions)
        .where(eq(transactions.type, type))
        .orderBy(desc(transactions.createdAt))
        .limit(1);

    const lastInvoice = lastTransaction[0]?.invoice || "";
    // The sequence number is always the last "-NNNN" segment
    const lastInvoiceParts = lastInvoice.split("-");
    const lastNumberStr = lastInvoiceParts[lastInvoiceParts.length - 1] || "0";
    const lastNumber = parseInt(lastNumberStr, 10);
    const nextNumber = isNaN(lastNumber) ? 1 : lastNumber + 1;

    const seq = String(nextNumber).padStart(4, "0");

    if (normalizedCode) {
        return `${normalizedCode}-${prefix}-${today}-${seq}`;
    }
    return `${prefix}-${today}-${seq}`;
}

export async function generateExpenseCode(branchCode?: string | null) {
    let prefix = "EXP";
    try {
        const globalSettings = await db.query.settings.findFirst({
            where: eq(settings.id, "global"),
        });
        if (globalSettings?.expensePrefix) {
            prefix = globalSettings.expensePrefix;
        }
    } catch (e) {}

    const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const normalizedCode = branchCode ? branchCode.trim().toUpperCase().slice(0, 3) : null;

    const { expenses } = await import("@/db/schemas");
    const lastExpense = await db
        .select()
        .from(expenses)
        .orderBy(desc(expenses.createdAt))
        .limit(1);

    const lastCode = lastExpense[0]?.code || "";
    const lastParts = lastCode.split("-");
    const lastNumberStr = lastParts[lastParts.length - 1] || "0";
    const lastNumber = parseInt(lastNumberStr, 10);
    const nextNumber = isNaN(lastNumber) ? 1 : lastNumber + 1;
    const seq = String(nextNumber).padStart(4, "0");

    if (normalizedCode) {
        return `${normalizedCode}-${prefix}-${today}-${seq}`;
    }
    return `${prefix}-${today}-${seq}`;
}

