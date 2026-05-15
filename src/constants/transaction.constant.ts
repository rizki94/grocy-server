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
    "pos_sales_tax",
    "sales_tax",
    "purchase_tax",
] as const;

export type TransactionType = (typeof transactionTypes)[number];

export const transactionPrefixes = {
    purchase: "PUR",
    sales: "SLS",
    sales_return: "SLR",
    purchase_return: "PCR",
    transfer_stock: "TRF",
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
    pos_sales_tax: "OUT",
    sales_tax: "OUT",
    purchase_tax: "IN",
};
