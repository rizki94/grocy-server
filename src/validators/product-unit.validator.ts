import { z } from "zod";

export const productUnitInsertSchema = z.object({
    name: z.string().min(1, "Name must be at least 1 characters"),
    abbreviation: z
        .string()
        .min(1, "Abbreviation must be at least 1 characters")
        .max(10, "Abbreviation must be at most 10 characters")
        .optional(),
});

export const productUnitUpdateSchema = productUnitInsertSchema.extend({
    id: z.string().min(1, "ID is required"),
});

export type ProductUnitInsertInput = z.infer<typeof productUnitInsertSchema>;
