import { db } from "@/db";
import { contacts, marketplaces } from "@/db/schemas";
import { and, eq, ilike, isNotNull, or, sql } from "drizzle-orm";
import { Request, Response } from "express";

const DEFAULT_MARKETPLACES = [
    { name: "Shopee", code: "shopee" },
    { name: "TikTok", code: "tiktok" },
    { name: "Tokopedia", code: "tokopedia" },
    { name: "Lazada", code: "lazada" },
    { name: "Blibli", code: "blibli" },
];

export async function ensureDefaultMarketplaces() {
    try {
        const existing = await db.select().from(marketplaces).limit(1);
        if (existing.length === 0) {
            for (const m of DEFAULT_MARKETPLACES) {
                await db
                    .insert(marketplaces)
                    .values({
                        name: m.name,
                        code: m.code,
                        isActive: true,
                    })
                    .onConflictDoNothing();
            }
        }
    } catch (err) {
        console.error("Failed to seed default marketplaces:", err);
    }
}

export const getAllMarketplaces = async (req: Request, res: Response) => {
    try {
        await ensureDefaultMarketplaces();
        const { mappedOnly } = req.query;

        const whereClauses = [eq(marketplaces.isActive, true)];
        if (mappedOnly === "true") {
            whereClauses.push(isNotNull(marketplaces.contactId));
        }

        const data = await db
            .select({
                id: marketplaces.id,
                name: marketplaces.name,
                code: marketplaces.code,
                contactId: marketplaces.contactId,
                contactName: contacts.name,
                isActive: marketplaces.isActive,
                createdAt: marketplaces.createdAt,
                updatedAt: marketplaces.updatedAt,
            })
            .from(marketplaces)
            .leftJoin(contacts, eq(marketplaces.contactId, contacts.id))
            .where(and(...whereClauses))
            .orderBy(marketplaces.name);

        res.status(200).json(data);
    } catch (error) {
        console.error("Error fetching marketplaces:", error);
        res.status(500).json({ message: "Failed to fetch marketplaces" });
    }
};

export const getPaginatedMarketplaces = async (req: Request, res: Response) => {
    try {
        await ensureDefaultMarketplaces();
        const { search = "", pageIndex = "0", pageSize = "10" } = req.query;
        const page = parseInt(pageIndex as string, 10) || 0;
        const limit = parseInt(pageSize as string, 10) || 10;
        const offset = page * limit;

        const searchCondition = search
            ? or(
                  ilike(marketplaces.name, `%${search}%`),
                  ilike(marketplaces.code, `%${search}%`),
                  ilike(contacts.name, `%${search}%`)
              )
            : undefined;

        const [countResult] = await db
            .select({ count: sql<number>`count(*)` })
            .from(marketplaces)
            .leftJoin(contacts, eq(marketplaces.contactId, contacts.id))
            .where(searchCondition);

        const rowCount = Number(countResult?.count || 0);

        const rows = await db
            .select({
                id: marketplaces.id,
                name: marketplaces.name,
                code: marketplaces.code,
                contactId: marketplaces.contactId,
                contactName: contacts.name,
                isActive: marketplaces.isActive,
                createdAt: marketplaces.createdAt,
                updatedAt: marketplaces.updatedAt,
            })
            .from(marketplaces)
            .leftJoin(contacts, eq(marketplaces.contactId, contacts.id))
            .where(searchCondition)
            .orderBy(marketplaces.name)
            .limit(limit)
            .offset(offset);

        res.status(200).json({
            rows,
            rowCount,
            pageCount: Math.ceil(rowCount / limit),
        });
    } catch (error) {
        console.error("Error fetching paginated marketplaces:", error);
        res.status(500).json({ message: "Failed to fetch paginated marketplaces" });
    }
};

export const getMarketplaceById = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const [marketplace] = await db
            .select({
                id: marketplaces.id,
                name: marketplaces.name,
                code: marketplaces.code,
                contactId: marketplaces.contactId,
                contactName: contacts.name,
                isActive: marketplaces.isActive,
                createdAt: marketplaces.createdAt,
                updatedAt: marketplaces.updatedAt,
            })
            .from(marketplaces)
            .leftJoin(contacts, eq(marketplaces.contactId, contacts.id))
            .where(eq(marketplaces.id, id));

        if (!marketplace) {
            return res.status(404).json({ message: "Marketplace not found" });
        }

        res.status(200).json(marketplace);
    } catch (error) {
        console.error("Error fetching marketplace:", error);
        res.status(500).json({ message: "Failed to fetch marketplace" });
    }
};

export const createMarketplace = async (req: Request, res: Response) => {
    const { name, code, contactId } = req.body;
    if (!name || !code) {
        return res.status(400).json({ message: "Name and code are required" });
    }

    try {
        const [created] = await db
            .insert(marketplaces)
            .values({
                name: name.trim(),
                code: code.trim().toLowerCase(),
                contactId: contactId || null,
                isActive: true,
            })
            .returning();

        res.status(201).json(created);
    } catch (error: any) {
        console.error("Error creating marketplace:", error);
        res.status(500).json({ message: error.message || "Failed to create marketplace" });
    }
};

export const updateMarketplace = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { name, code, contactId, isActive } = req.body;

    try {
        const [updated] = await db
            .update(marketplaces)
            .set({
                ...(name ? { name: name.trim() } : {}),
                ...(code ? { code: code.trim().toLowerCase() } : {}),
                ...(contactId !== undefined ? { contactId: contactId || null } : {}),
                ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
                updatedAt: new Date(),
            })
            .where(eq(marketplaces.id, id))
            .returning();

        if (!updated) {
            return res.status(404).json({ message: "Marketplace not found" });
        }

        res.status(200).json(updated);
    } catch (error: any) {
        console.error("Error updating marketplace:", error);
        res.status(500).json({ message: error.message || "Failed to update marketplace" });
    }
};

export const deleteMarketplace = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const [deleted] = await db
            .update(marketplaces)
            .set({ isActive: false })
            .where(eq(marketplaces.id, id))
            .returning();

        if (!deleted) {
            return res.status(404).json({ message: "Marketplace not found" });
        }

        res.status(200).json({ message: "Marketplace deactivated successfully" });
    } catch (error: any) {
        console.error("Error deleting marketplace:", error);
        res.status(500).json({ message: error.message || "Failed to delete marketplace" });
    }
};
