import { users } from "@/db/schemas";
import { createSelectSchema } from "drizzle-zod";
import z from "zod";

export const userInsertSchema = z.object({
    username: z
        .string()
        .min(4, "Username minimum 4 characters")
        .max(12, "Username maximum 12 characters"),
    password: z.string().min(6).max(50),
    roleId: z.string().min(1, "Role is required"),
    isActive: z.boolean().default(true),
});

export const userUpdateSchema = userInsertSchema.extend({
    id: z.string().min(1, "ID is required"),
    password: z.string().min(6).max(50).optional().or(z.literal("")),
});

export type UserInsertInput = z.infer<typeof userInsertSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
export type UserModel = typeof users.$inferSelect;
