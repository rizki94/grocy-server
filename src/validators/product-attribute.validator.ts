import { attributeType } from "@/constants/product.constant";
import { z } from "zod";

export const productAttributeInsertSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    label: z.string().min(2, "Label must be at least 2 characters"),
    type: z.enum(attributeType),
    options: z.array(z.string()).optional().default([]),
});

export const productAttributeUpdateSchema = productAttributeInsertSchema.extend(
    {
        id: z.string().min(1, "ID is required"),
    }
);

export type ProductAttributeInsertInput = z.infer<
    typeof productAttributeInsertSchema
>;
