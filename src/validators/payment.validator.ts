import z from "zod";

const paymentLineInsertSchema = z.object({
    openInvoiceId: z.string().uuid(),
    amount: z.number(),
});

const paymentAccountInsertSchema = z.object({
    glAccountId: z.string().uuid(),
    amount: z.number(),
});

export const paymentInsertSchema = z.object({
    contactId: z.string().uuid({ message: "Supplier is required" }),
    date: z.string(),
    totalAmount: z.number({ invalid_type_error: "Total is required" }),
    status: z.enum(["draft", "posted"]).optional(),
    type: z.enum(["receivable", "payable"]),
    reference: z.string().optional(),
    note: z.string().optional(),
});

export const paymentWithLinesInsertSchema = paymentInsertSchema
    .extend({
        lines: z.array(paymentLineInsertSchema).min(1),
        accounts: z.array(paymentAccountInsertSchema),
    })
    .refine(
        (data) => {
            const linesTotal = data.lines.reduce(
                (sum, line) => sum + line.amount,
                0,
            );
            const accountsTotal = data.accounts.reduce(
                (sum, acc) => sum + acc.amount,
                0,
            );
            // Use a small epsilon for floating point comparison if needed, or stick to strict equality
            return Math.abs(linesTotal - accountsTotal) < 0.01;
        },
        {
            message: "Total Payment Amount must match Total Account Amount",
            path: ["totalAmount"], // Associate error with totalAmount field
        },
    );

export const paymentWithLinesUpdateSchema = paymentWithLinesInsertSchema.and(
    z.object({
        id: z.string(),
    }),
);

export const openInvoicesInsertSchema = z.object({
    id: z.string(),
    invoice: z.string(),
    dueDate: z.string(),
    amount: z.number(),
    paidAmount: z.number(),
    status: z.enum(["open", "partial", "paid", "overpaid"]),
});

export type PaymentWithLinesInsert = z.infer<
    typeof paymentWithLinesInsertSchema
>;
export type PaymentWithLinesUpdate = z.infer<
    typeof paymentWithLinesUpdateSchema
>;

export type OpenInvoicesInsert = z.infer<typeof openInvoicesInsertSchema>;
