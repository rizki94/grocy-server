import z from "zod";

export const taxInsertSchema = z.object({
    name: z.string().min(4, "Name minimum 4 characters"),
    rate: z.number().min(0).max(100),
});

export const taxUpdateSchema = taxInsertSchema.extend({
    id: z.string().min(1, "ID is required"),
});

export type TaxInsertInput = z.infer<typeof taxInsertSchema>;
export type TaxUpdateInput = z.infer<typeof taxUpdateSchema>;
