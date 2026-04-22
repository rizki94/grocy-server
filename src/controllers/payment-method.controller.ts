import { db } from "@/db";
import { paymentMethods } from "@/db/schemas";
import { Request, Response } from "express";
import { eq } from "drizzle-orm";

export async function getAllPaymentMethods(req: Request, res: Response) {
    try {
        let data = await db.select().from(paymentMethods);

        if (data.length === 0) {
            // Seed defaults
            await db.insert(paymentMethods).values([
                { name: "Cash", color: "#22c55e", icon: "IconCash", isCash: true },
                { name: "Bank Transfer", color: "#3b82f6", icon: "IconBuildingBank", isCash: false },
                { name: "Down Payment", color: "#eab308", icon: "IconCheck", isCash: true }
            ]);
            data = await db.select().from(paymentMethods);
        }

        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ message: "Failed to get payment methods" });
    }
}

export async function createPaymentMethod(req: Request, res: Response) {
    try {
        const [data] = await db.insert(paymentMethods).values(req.body).returning();
        res.status(201).json(data);
    } catch (error) {
        res.status(500).json({ message: "Failed to create payment method" });
    }
}

export async function updatePaymentMethod(req: Request, res: Response) {
    try {
        const [data] = await db
            .update(paymentMethods)
            .set(req.body)
            .where(eq(paymentMethods.id, req.params.id))
            .returning();
        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ message: "Failed to update payment method" });
    }
}

export async function deletePaymentMethod(req: Request, res: Response) {
    try {
        await db.delete(paymentMethods).where(eq(paymentMethods.id, req.params.id));
        res.status(200).json({ message: "Deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: "Failed to delete payment method" });
    }
}
