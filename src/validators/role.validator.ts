import { roles } from "@/db/schemas";
import z from "zod";

export const roleInsertSchema = z.object({
    name: z.string().min(4).max(50),
    permissions: z.array(z.string()),
});

export const roleUpdateSchema = roleInsertSchema.extend({
    id: z.string().min(1, "ID is required"),
});

export const rolePermissionUpdateSchema = z.object({
    roleId: z.string(),
    permissionId: z.string(),
    hasPermission: z.boolean().optional(),
});

export type RoleInsertInput = z.infer<typeof roleInsertSchema>;
export type RoleUpdateInput = z.infer<typeof roleUpdateSchema>;
export type RoleModel = typeof roles.$inferSelect;
