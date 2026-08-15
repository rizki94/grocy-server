import { Request, Response } from "express";
import { db } from "@/db";
import { trucks } from "@/db/schemas";
import { eq, desc } from "drizzle-orm";

export const getTrucks = async (req: Request, res: Response) => {
    try {
        const rows = await db
            .select()
            .from(trucks)
            .orderBy(trucks.name);
        return res.status(200).json(rows);
    } catch (error) {
        console.error("Error fetching trucks:", error);
        return res.status(500).json({ message: "Failed to fetch trucks" });
    }
};

export const createTruck = async (req: Request, res: Response) => {
    try {
        const { name, licensePlate, maxWeight, maxVolume, isActive } = req.body;

        if (!name || !licensePlate) {
            return res.status(400).json({ message: "Name and license plate are required" });
        }

        const [created] = await db
            .insert(trucks)
            .values({
                name,
                licensePlate,
                maxWeight: Number(maxWeight || 0),
                maxVolume: Number(maxVolume || 0),
                isActive: isActive !== undefined ? Boolean(isActive) : true,
            })
            .returning();

        return res.status(201).json({ message: "Truck created successfully", truck: created });
    } catch (error: any) {
        console.error("Error creating truck:", error);
        if (error.code === "23505") {
            return res.status(400).json({ message: "License plate already exists" });
        }
        return res.status(500).json({ message: "Failed to create truck" });
    }
};

export const updateTruck = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { name, licensePlate, maxWeight, maxVolume, isActive } = req.body;

        const [updated] = await db
            .update(trucks)
            .set({
                name,
                licensePlate,
                maxWeight: Number(maxWeight || 0),
                maxVolume: Number(maxVolume || 0),
                isActive: Boolean(isActive),
            })
            .where(eq(trucks.id, id))
            .returning();

        if (!updated) {
            return res.status(404).json({ message: "Truck not found" });
        }

        return res.status(200).json({ message: "Truck updated successfully", truck: updated });
    } catch (error: any) {
        console.error("Error updating truck:", error);
        return res.status(500).json({ message: "Failed to update truck" });
    }
};

export const deleteTruck = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        await db.delete(trucks).where(eq(trucks.id, id));
        return res.status(200).json({ message: "Truck deleted successfully" });
    } catch (error) {
        console.error("Error deleting truck:", error);
        return res.status(500).json({ message: "Failed to delete truck" });
    }
};
