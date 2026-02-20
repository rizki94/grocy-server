import { z } from "zod";

export const productDetailPriceInsertSchema = z.object({
    id: z
        .string()
        .uuid()
        .optional()
        .or(z.literal(""))
        .transform((val) => (val === "" ? undefined : val)),
    priceGroupId: z.string().uuid({ message: "priceGroupId is required" }),
    price: z.number().min(0).optional().default(0),
});

export const productDetailInsertSchema = z.object({
    id: z
        .string()
        .uuid()
        .optional()
        .or(z.literal(""))
        .transform((val) => (val === "" ? undefined : val)),
    unitId: z.string().uuid({ message: "Unit is required" }),
    skuId: z.string().min(1, "SKU ID is required"),
    barcode: z.string().nullable(),
    level: z.number().min(0),
    ratio: z.number().min(1),
    baseRatio: z.number().min(1),
    cost: z.number().min(0).optional().default(0),
    weight: z.number().min(0).optional().default(0),
    volume: z.number().min(0).optional().default(0),
    length: z.number().min(0).optional().default(0),
    width: z.number().min(0).optional().default(0),
    height: z.number().min(0).optional().default(0),
    isSellable: z.boolean().optional().default(true),
    isDefault: z.boolean().optional().default(false),
    prices: z.array(productDetailPriceInsertSchema).optional().default([]),
});

export const productAttributeValueSchema = z.object({
    id: z
        .string()
        .uuid()
        .optional()
        .or(z.literal(""))
        .transform((val) => (val === "" ? undefined : val)),
    attributeId: z.string().uuid({ message: "attributeId is required" }),
    value: z.string().min(1, "value is required"),
});

export const productImageSchema = z.object({
    id: z
        .string()
        .uuid()
        .optional()
        .or(z.literal(""))
        .transform((val) => (val === "" ? undefined : val)),
    filename: z.string().min(1, "filename required"),
    url: z.string().min(1, "Invalid image url"),
    mimetype: z.string().optional(),
    size: z
        .number()
        .max(5 * 1024 * 1024)
        .optional(),
});

export const productInsertSchema = z.object({
    name: z.string().min(3, "name min 3 chars"),
    description: z.string().optional(),
    isActive: z.boolean(),
    taxId: z.string(),
});

export const productWithDetailInsertSchema = productInsertSchema.extend({
    details: z.array(productDetailInsertSchema).optional().default([]),
    attributes: z.array(productAttributeValueSchema).optional().default([]),
    images: z.array(productImageSchema).optional().default([]),
});

export const productWithDetailUpdateSchema =
    productWithDetailInsertSchema.extend({
        id: z.string().uuid({ message: "product id is required" }),
    });

export type ProductInsertInput = z.infer<typeof productWithDetailInsertSchema>;
export type ProductUpdateInput = z.infer<typeof productWithDetailUpdateSchema>;
