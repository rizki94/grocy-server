import z from "zod";

export const deliveryRouteInsertSchema = z.object({
    name: z.string().min(3, "Name minimum 3 characters"),
    description: z.string().optional(),
    isActive: z.boolean().default(true),
});

export const deliveryRouteUpdateSchema = deliveryRouteInsertSchema.extend({
    id: z.string().min(1, "ID is required"),
});

export type DeliveryRouteInsertInput = z.infer<typeof deliveryRouteInsertSchema>;
export type DeliveryRouteUpdateInput = z.infer<typeof deliveryRouteUpdateSchema>;
