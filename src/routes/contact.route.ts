import { Router, Request, Response } from "express";
import { db } from "@/db";
import { contacts } from "@/db/schemas";
import { eq } from "drizzle-orm";

const contactRouter = Router();

contactRouter.get("/active", async (req: Request, res: Response) => {
    try {
        const list = await db
            .select({
                id: contacts.id,
                name: contacts.name,
                contactType: contacts.contactType,
            })
            .from(contacts)
            .where(eq(contacts.isActive, true))
            .orderBy(contacts.name);
        res.json(list);
    } catch (error) {
        res.status(500).json({ message: "Failed to fetch active contacts" });
    }
});

export default contactRouter;
