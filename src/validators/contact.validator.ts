import z from "zod";

export const contactInsertSchema = z.object({
    name: z.string().min(4, "Username minimum 4 characters"),
    address: z.string().min(4, "Address minimum 4 characters"),
    termOfPayment: z
        .number()
        .min(0, "Term of payment cannot be negative")
        .max(90, "Term of payment must be less than 90 days"),
    invoiceLimit: z.number().min(0).optional().nullable(),
    creditLimit: z.number().min(0).optional().nullable(),
    phone: z.string().min(4, "Phone minimum 4 characters"),
    email: z.string().min(4, "Email minimum 4 characters"),
    priceGroupId: z.string().uuid().optional().nullable(),
    latitude: z.number().optional().nullable(),
    longitude: z.number().optional().nullable(),
    routeGroupId: z.string().uuid().optional().nullable(),
    salespersonId: z.string().uuid().optional().nullable(),
    npwp: z.string().max(32).optional().nullable(),
    nitku: z.string().max(32).optional().nullable(),
    isPkp: z.boolean().optional(),
    taxAddress: z.string().max(300).optional().nullable(),
    isActive: z.boolean(),
});

export const contactUpdateSchema = contactInsertSchema.extend({
    id: z.string().min(1, "ID is required"),
});

export const customerInsertSchema = contactInsertSchema.extend({
    priceGroupId: z.string().uuid("Price group is required"),
});

export const customerUpdateSchema = customerInsertSchema.extend({
    id: z.string().min(1, "ID is required"),
});

export type UserInsertInput = z.infer<typeof contactInsertSchema>;
export type UserUpdateInput = z.infer<typeof contactUpdateSchema>;
export type CustomerInsertInput = z.infer<typeof customerInsertSchema>;
export type CustomerUpdateInput = z.infer<typeof customerUpdateSchema>;
