import { Request, Response } from "express";
import { db } from "@/db";
import { branches, warehouses, transactions } from "@/db/schemas";
import { eq, desc, count } from "drizzle-orm";

export async function getAllBranches(req: Request, res: Response) {
    try {
        const rows = await db
            .select()
            .from(branches)
            .orderBy(desc(branches.isHq), branches.name);

        return res.json({ data: rows });
    } catch (error: any) {
        return res.status(500).json({ message: error.message });
    }
}

export async function getBranchById(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const [branch] = await db
            .select()
            .from(branches)
            .where(eq(branches.id, id))
            .limit(1);

        if (!branch) {
            return res.status(404).json({ message: "Branch not found" });
        }

        return res.json({ data: branch });
    } catch (error: any) {
        return res.status(500).json({ message: error.message });
    }
}

export async function createBranch(req: Request, res: Response) {
    try {
        const { code, name, address, phone, isHq, isActive } = req.body;

        if (!code || !name) {
            return res.status(400).json({ message: "Code and Name are required" });
        }

        if (code.trim().length > 3) {
            return res.status(400).json({ message: "Branch code must be 3 characters or less" });
        }

        const [existing] = await db
            .select()
            .from(branches)
            .where(eq(branches.code, code))
            .limit(1);

        if (existing) {
            return res.status(400).json({ message: `Branch with code "${code}" already exists` });
        }

        const [created] = await db
            .insert(branches)
            .values({
                code: code.trim().toUpperCase(),
                name: name.trim(),
                address,
                phone,
                isHq: Boolean(isHq),
                isActive: isActive !== undefined ? Boolean(isActive) : true,
            })
            .returning();

        return res.status(201).json({ data: created });
    } catch (error: any) {
        return res.status(500).json({ message: error.message });
    }
}

export async function updateBranch(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const { code, name, address, phone, isHq, isActive } = req.body;

        const [existing] = await db
            .select()
            .from(branches)
            .where(eq(branches.id, id))
            .limit(1);

        if (!existing) {
            return res.status(404).json({ message: "Branch not found" });
        }

        if (code) {
            if (code.trim().length > 3) {
                return res.status(400).json({ message: "Branch code must be 3 characters or less" });
            }
        }

        if (code && code !== existing.code) {
            const [codeConflict] = await db
                .select()
                .from(branches)
                .where(eq(branches.code, code))
                .limit(1);

            if (codeConflict) {
                return res.status(400).json({ message: `Branch code "${code}" already in use` });
            }
        }

        const [updated] = await db
            .update(branches)
            .set({
                ...(code ? { code: code.trim().toUpperCase() } : {}),
                ...(name ? { name: name.trim() } : {}),
                ...(address !== undefined ? { address } : {}),
                ...(phone !== undefined ? { phone } : {}),
                ...(isHq !== undefined ? { isHq: Boolean(isHq) } : {}),
                ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
                updatedAt: new Date(),
            })
            .where(eq(branches.id, id))
            .returning();

        return res.json({ data: updated });
    } catch (error: any) {
        return res.status(500).json({ message: error.message });
    }
}

export async function deleteBranch(req: Request, res: Response) {
    try {
        const { id } = req.params;

        const [branch] = await db
            .select()
            .from(branches)
            .where(eq(branches.id, id))
            .limit(1);

        if (!branch) {
            return res.status(404).json({ message: "Branch not found" });
        }

        if (branch.isHq) {
            return res.status(400).json({ message: "Cannot delete the default HQ branch" });
        }

        // Check if warehouses or transactions are tied to this branch
        const [warehouseCheck] = await db
            .select({ count: count() })
            .from(warehouses)
            .where(eq(warehouses.branchId, id));

        const [txCheck] = await db
            .select({ count: count() })
            .from(transactions)
            .where(eq(transactions.branchId, id));

        if ((warehouseCheck?.count || 0) > 0 || (txCheck?.count || 0) > 0) {
            // Soft deactivate instead of hard delete
            const [deactivated] = await db
                .update(branches)
                .set({ isActive: false, updatedAt: new Date() })
                .where(eq(branches.id, id))
                .returning();

            return res.json({
                message: "Branch has existing data and was deactivated instead of deleted",
                data: deactivated,
            });
        }

        await db.delete(branches).where(eq(branches.id, id));
        return res.json({ message: "Branch deleted successfully" });
    } catch (error: any) {
        return res.status(500).json({ message: error.message });
    }
}
