import { db } from "@/db";
import { returnReasons } from "@/db/schemas";
import { sql, eq, or, and } from "drizzle-orm";
import { Request, Response } from "express";

const DEFAULT_RETURN_REASONS = [
    { name: "Damaged Goods", code: "DAMAGED", type: "all", description: "Product arrived damaged or broken" },
    { name: "Expired Product", code: "EXPIRED", type: "all", description: "Product has passed expiration date" },
    { name: "Wrong Item Delivered", code: "WRONG_ITEM", type: "all", description: "Item does not match order specification" },
    { name: "Defective Quality", code: "DEFECTIVE", type: "all", description: "Manufacturing defect or quality failure" },
    { name: "Customer Cancellation", code: "CANCELLATION", type: "sales_return", description: "Customer changed mind or cancelled order" },
    { name: "Overstocked / Surplus", code: "SURPLUS", type: "purchase_return", description: "Excess inventory returned to vendor" },
    { name: "Other / Unspecified", code: "OTHER", type: "all", description: "Other return reason" },
];

async function ensureDefaultReasons() {
    try {
        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS return_reasons (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name VARCHAR(255) NOT NULL,
                code VARCHAR(100),
                type VARCHAR(50) NOT NULL DEFAULT 'all',
                description TEXT,
                is_active BOOLEAN NOT NULL DEFAULT true,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
            );
        `);

        await db.execute(sql`
            ALTER TABLE transaction_details ADD COLUMN IF NOT EXISTS return_reason_id UUID REFERENCES return_reasons(id);
        `);

        const existing = await db.select().from(returnReasons).limit(1);
        if (existing.length === 0) {
            for (const r of DEFAULT_RETURN_REASONS) {
                await db.insert(returnReasons).values({
                    name: r.name,
                    code: r.code,
                    type: r.type as any,
                    description: r.description,
                    isActive: true,
                });
            }
        }
    } catch (err) {
        console.error("Failed to seed default return reasons:", err);
    }
}


export const getAllReturnReasons = async (req: Request, res: Response) => {
    try {
        await ensureDefaultReasons();
        const { type } = req.query;

        let query = db.select().from(returnReasons).where(eq(returnReasons.isActive, true));

        if (type && typeof type === "string" && type !== "all") {
            const list = await db
                .select()
                .from(returnReasons)
                .where(
                    and(
                        eq(returnReasons.isActive, true),
                        or(eq(returnReasons.type, type as any), eq(returnReasons.type, "all"))
                    )
                );
            return res.status(200).json(list);
        }

        const list = await query;
        return res.status(200).json(list);
    } catch (error) {
        console.error("Error fetching return reasons:", error);
        return res.status(500).json({ message: "Failed to fetch return reasons" });
    }
};

export const createReturnReason = async (req: Request, res: Response) => {
    try {
        const { name, code, type, description } = req.body;

        if (!name) {
            return res.status(400).json({ message: "Reason name is required" });
        }

        const [inserted] = await db
            .insert(returnReasons)
            .values({
                name,
                code: code || name.toUpperCase().replace(/\s+/g, "_"),
                type: type || "all",
                description,
                isActive: true,
            })
            .returning();

        return res.status(201).json(inserted);
    } catch (error) {
        console.error("Error creating return reason:", error);
        return res.status(500).json({ message: "Failed to create return reason" });
    }
};

export const updateReturnReason = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { name, code, type, description, isActive } = req.body;

        const [updated] = await db
            .update(returnReasons)
            .set({
                name,
                code,
                type,
                description,
                isActive,
            })
            .where(eq(returnReasons.id, id))
            .returning();

        if (!updated) {
            return res.status(404).json({ message: "Return reason not found" });
        }

        return res.status(200).json(updated);
    } catch (error) {
        console.error("Error updating return reason:", error);
        return res.status(500).json({ message: "Failed to update return reason" });
    }
};

export const deleteReturnReason = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        await db
            .update(returnReasons)
            .set({ isActive: false })
            .where(eq(returnReasons.id, id));

        return res.status(200).json({ message: "Return reason deactivated successfully" });
    } catch (error) {
        console.error("Error deleting return reason:", error);
        return res.status(500).json({ message: "Failed to delete return reason" });
    }
};
