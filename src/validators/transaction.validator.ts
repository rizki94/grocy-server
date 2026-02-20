import { transactionStatuses } from "@/constants/transaction.constant";
import z from "zod";

export const transactionInsertSchema = z.object({
    contactId: z.string().nullable().optional(),
    date: z.string(),
    termOfPayment: z
        .number()
        .min(0, "Term of payment cannot be negative")
        .max(90, "Term of payment must be less than 90 days"),
    reference: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
    subtotal: z.number(),
    totalDiscount: z.number(),
    totalAmount: z.number(),
    totalTax: z.number(),
    status: z.enum(transactionStatuses),
    parentId: z.string().nullable().optional(),
});

const transactionDetailBaseSchema = z.object({
    productId: z.string().min(1, "Product is required"),
    productDetailId: z.string().min(1, "Product detail is required"),
    warehouseId: z.string().uuid().nullable().optional(),
    baseRatio: z.number(),
    qty: z.number(),
    price: z.number(),
    discount: z.number(),
    unitCost: z.number(),
    totalCost: z.number(),
    amount: z.number(),
    taxRate: z.number(),
});

export const transactionDetailInsertSchema = transactionDetailBaseSchema.refine(
    (data) => data.discount <= data.price,
    {
        message: "Discount cannot be larger than price",
        path: ["discount"],
    },
);

export const transactionWithDetailInsertSchema = transactionInsertSchema.extend(
    {
        details: z.array(transactionDetailInsertSchema),
    },
);

export const transactionUpdateSchema = transactionInsertSchema.extend({
    id: z.string().min(1, "ID is required"),
});

export const transactionDetailUpdateSchema = transactionDetailBaseSchema
    .extend({
        id: z.string().optional(),
    })
    .refine((data) => data.discount <= data.price, {
        message: "Discount cannot be larger than price",
        path: ["discount"],
    });

export const transactionWithDetailUpdateSchema = transactionUpdateSchema.extend(
    {
        details: z.array(transactionDetailUpdateSchema),
    },
);

export const stockInsertSchema = z.object({
    id: z.string().optional(),
    productId: z.string(),
    warehouseId: z.string(),
    qty: z.number(),
    baseRatio: z.number(),
    stockId: z.string().optional(),
});

export const transferStockInsertSchema = z.object({
    date: z.string(),
    warehouseIn: z.string().min(1, "Warehouse In is required"),
    warehouseOut: z.string().min(1, "Warehouse Out is required"),
    reference: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
    status: z.enum(transactionStatuses),
});

export const transferStockDetailInsertSchema = z.object({
    productId: z.string().min(1, "Product is required"),
    productDetailId: z.string().min(1, "Product detail is required"),
    baseRatio: z.number(),
    qty: z.number(),
});

export const transferStockUpdateSchema = transferStockInsertSchema.extend({
    id: z.string().min(1, "ID is required"),
});

export const transferStockWithDetailInsertSchema =
    transferStockInsertSchema.extend({
        details: z.array(transferStockDetailInsertSchema),
    });

export const transferStockWithDetailUpdateSchema =
    transferStockWithDetailInsertSchema.extend({
        id: z.string().min(1, "ID is required"),
    });

export type TransactionInsertInput = z.infer<typeof transactionInsertSchema>;
export type TransactionDetailInsertInput = z.infer<
    typeof transactionDetailInsertSchema
>;
export type TransactionWithDetailInsertInput = z.infer<
    typeof transactionWithDetailInsertSchema
>;

export type StockInsertInput = z.infer<typeof stockInsertSchema>;

export type TransferStockWithDetailInsertInput = z.infer<
    typeof transferStockWithDetailInsertSchema
>;

export type TransferStockWithDetailUpdateInput = z.infer<
    typeof transferStockWithDetailUpdateSchema
>;
