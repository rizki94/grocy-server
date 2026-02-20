import { glAccountType } from "@/constants/journal.constant";
import { glAccounts } from "@/db/schemas";
import z from "zod";

export const glAccountInsertSchema = z.object({
    name: z.string().min(4, "Name minimum 4 characters"),
    code: z.string().min(1, "Code is required"),
    type: z.enum(glAccountType),
    parentId: z.string().optional(),
    isActive: z.boolean().default(true),
});

export const glAccountUpdateSchema = glAccountInsertSchema.extend({
    id: z.string().uuid("ID is required"),
});

export type GlAccountInsertInput = z.infer<typeof glAccountInsertSchema>;
export type GlAccountUpdateInput = z.infer<typeof glAccountUpdateSchema>;
export type GlAccountModel = typeof glAccounts.$inferSelect;
