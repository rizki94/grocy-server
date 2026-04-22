export const transactionStatuses = [
    "draft",
    "order",
    "posted",
    "partial",
    "paid",
    "cancelled",
] as const;

export const transactionTypes = [
    "purchase",
    "sales",
    "sales_return",
    "purchase_return",
    "transfer_stock",
    "adjustment",
    "pos_sales",
] as const;

export type TransactionType = (typeof transactionTypes)[number];

export const transactionPrefixes = {
    purchase: "P",
    sales: "S",
    sales_return: "SR",
    purchase_return: "PR",
    transfer_stock: "TS",
    adjustment: "ADJ",
    pos_sales: "POS",
};

export const typeMap: Record<(typeof transactionTypes)[number], "IN" | "OUT"> =
{
    sales: "OUT",
    purchase: "IN",
    sales_return: "IN",
    purchase_return: "OUT",
    transfer_stock: "IN",
    adjustment: "IN",
    pos_sales: "OUT",
};
