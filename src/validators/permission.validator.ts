import { permissions } from "@/db/schemas";
import z from "zod";

export const permissionInsertSchema = z.object({
    code: z
        .string()
        .min(4, "Name minimum 4 characters")
        .max(12, "Name maximum 12 characters"),
    description: z.string().optional(),
    groupId: z.string().min(1, "Group is required"),
});

export const permissionUpdateSchema = permissionInsertSchema.extend({
    id: z.string().min(1, "ID is required"),
});

export const permissionGroupInsertSchema = z.object({
    name: z.string().min(4, "Name minimum 4 characters"),
})

export type PermissionInsertInput = z.infer<typeof permissionInsertSchema>;
export type PermissionUpdateInput = z.infer<typeof permissionUpdateSchema>;
export type PermissionModel = typeof permissions.$inferSelect;
export type PermissionGroupInsertInput = z.infer<typeof permissionGroupInsertSchema>;
