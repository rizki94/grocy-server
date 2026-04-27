import { Request, Response } from "express";
import { db } from "@/db";
import { settings, glAccounts } from "@/db/schemas";
import { eq } from "drizzle-orm";

export const getSettings = async (req: Request, res: Response) => {
    try {
        const result = await db.query.settings.findFirst({
            where: eq(settings.id, "global"),
        });

        res.json(result);
    } catch (error) {
        console.error("Error fetching settings", error);
        res.status(500).json({ message: "Server Error" });
    }
};

export const updateSettings = async (req: Request, res: Response) => {
    try {
        const { posRound2Digit, allowNegativeStock, roundingDifferenceGlAccountId } = req.body;

        await db.update(settings).set({
            posRound2Digit,
            allowNegativeStock,
            roundingDifferenceGlAccountId,
            updatedAt: new Date(),
        }).where(eq(settings.id, "global"));

        res.json({ message: "Settings updated successfully" });
    } catch (error) {
        console.error("Error updating settings", error);
        res.status(500).json({ message: "Server Error" });
    }
};
