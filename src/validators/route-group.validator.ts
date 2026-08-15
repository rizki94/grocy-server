import z from "zod";

export const routeGroupInsertSchema = z.object({
    name: z.string().min(1, "Name is required").max(100),
    description: z.string().optional().nullable(),
    isActive: z.boolean().default(true),
});

export const routeGroupUpdateSchema = routeGroupInsertSchema.extend({
    id: z.string().min(1, "ID is required"),
});

export type RouteGroupInsertInput = z.infer<typeof routeGroupInsertSchema>;
export type RouteGroupUpdateInput = z.infer<typeof routeGroupUpdateSchema>;
