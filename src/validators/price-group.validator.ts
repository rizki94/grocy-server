import z from "zod";

export const priceGroupInsertSchema = z.object({
    name: z.string().min(4, "Name minimum 4 characters"),
    description: z.string().optional().nullable(),
    isActive: z.boolean(),
});

export const priceGroupUpdateSchema = priceGroupInsertSchema.extend({
    id: z.string().min(1, "ID is required"),
});

export type PriceGroupInsertInput = z.infer<typeof priceGroupInsertSchema>;
export type PriceGroupUpdateInput = z.infer<typeof priceGroupUpdateSchema>;
