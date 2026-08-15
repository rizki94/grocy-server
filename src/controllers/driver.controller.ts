import { Request, Response } from "express";
import { db } from "@/db";
import { drivers, trucks } from "@/db/schemas";
import { eq } from "drizzle-orm";

const RANDOM_COLORS = [
    "#EF4444",
    "#F97316",
    "#F59E0B",
    "#10B981",
    "#06B6D4",
    "#3B82F6",
    "#6366F1",
    "#8B5CF6",
    "#EC4899",
    "#14B8A6",
    "#84CC16",
    "#D97706",
];

function getRandomColor() {
    return RANDOM_COLORS[Math.floor(Math.random() * RANDOM_COLORS.length)];
}

export const getDrivers = async (req: Request, res: Response) => {
    try {
        const rows = await db
            .select({
                id: drivers.id,
                name: drivers.name,
                color: drivers.color,
                defaultTruckId: drivers.defaultTruckId,
                defaultTruckName: trucks.name,
                defaultTruckPlate: trucks.licensePlate,
                isActive: drivers.isActive,
                createdAt: drivers.createdAt,
            })
            .from(drivers)
            .leftJoin(trucks, eq(trucks.id, drivers.defaultTruckId))
            .orderBy(drivers.name);

        return res.status(200).json(rows);
    } catch (error) {
        console.error("Error fetching drivers:", error);
        return res.status(500).json({ message: "Failed to fetch drivers" });
    }
};

export const createDriver = async (req: Request, res: Response) => {
    try {
        const { name, color, defaultTruckId, isActive } = req.body;

        if (!name) {
            return res.status(400).json({ message: "Driver name is required" });
        }

        const chosenColor = color || getRandomColor();

        const [created] = await db
            .insert(drivers)
            .values({
                name,
                color: chosenColor,
                defaultTruckId: defaultTruckId || null,
                isActive: isActive !== undefined ? Boolean(isActive) : true,
            })
            .returning();

        return res.status(201).json({ message: "Driver created successfully", driver: created });
    } catch (error) {
        console.error("Error creating driver:", error);
        return res.status(500).json({ message: "Failed to create driver" });
    }
};

export const updateDriver = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { name, color, defaultTruckId, isActive } = req.body;

        const [updated] = await db
            .update(drivers)
            .set({
                name,
                color: color || getRandomColor(),
                defaultTruckId: defaultTruckId || null,
                isActive: Boolean(isActive),
            })
            .where(eq(drivers.id, id))
            .returning();

        if (!updated) {
            return res.status(404).json({ message: "Driver not found" });
        }

        return res.status(200).json({ message: "Driver updated successfully", driver: updated });
    } catch (error) {
        console.error("Error updating driver:", error);
        return res.status(500).json({ message: "Failed to update driver" });
    }
};

export const deleteDriver = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        await db.delete(drivers).where(eq(drivers.id, id));
        return res.status(200).json({ message: "Driver deleted successfully" });
    } catch (error) {
        console.error("Error deleting driver:", error);
        return res.status(500).json({ message: "Failed to delete driver" });
    }
};
