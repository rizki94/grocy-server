import z from "zod";

export const warehouseInsertSchema = z.object({
    name: z.string().min(1, "Name is required"),
    address: z.string().optional().nullable(),
    phone: z.string().optional().nullable(),
    isActive: z.boolean().default(true),
});

export const warehouseUpdateSchema = warehouseInsertSchema.extend({
    id: z.string().min(1, "ID is required"),
});

export type WarehouseInsertInput = z.infer<typeof warehouseInsertSchema>;
export type WarehouseUpdateInput = z.infer<typeof warehouseUpdateSchema>;
