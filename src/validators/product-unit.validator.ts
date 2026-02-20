import { z } from "zod";

export const productUnitInsertSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    abbreviation: z
        .string()
        .min(2, "Abbreviation must be at least 2 characters")
        .max(3, "Abbreviation must be at most 3 characters"),
});

export const productUnitUpdateSchema = productUnitInsertSchema.extend({
    id: z.string().min(1, "ID is required"),
});

export type ProductUnitInsertInput = z.infer<typeof productUnitInsertSchema>;
