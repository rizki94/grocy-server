import { db } from "@/db";
import { priceGroups } from "@/db/schemas";
import { logAction } from "@/utils/log-helper";
import { CacheService } from "@/services/cache-service";
import { priceGroupInsertSchema, priceGroupUpdateSchema } from "@/validators/price-group.validator";
import { and, asc, desc, eq, like, or, sql } from "drizzle-orm";
import { PgColumn } from "drizzle-orm/pg-core";
import { Request, Response } from "express";

export async function getAllPriceGroups(req: Request, res: Response) {
    try {
        const data = await CacheService.getOrSet("priceGroups:all", 60, async () => {
            return db.select().from(priceGroups).orderBy(priceGroups.name);
        });
        res.status(200).json(data);
    } catch (error) {
        console.error("Error fetching price groups:", error);
        res.status(500).json({ message: "Failed to fetch price groups" });
    }
}

export async function getActivePriceGroups(req: Request, res: Response) {
    try {
        const data = await db
            .select()
            .from(priceGroups)
            .where(eq(priceGroups.isActive, true))
            .orderBy(priceGroups.name);

        res.status(200).json(data);
    } catch (error) {
        console.error("Error fetching active price groups:", error);
        res.status(500).json({ message: "Failed to fetch active price groups" });
    }
}

export const getPriceGroupById = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const [priceGroup] = await db
            .select()
            .from(priceGroups)
            .where(eq(priceGroups.id, id))
            .limit(1);

        if (!priceGroup) return res.status(404).json({ error: "Price group not found" });
        res.status(200).json(priceGroup);
    } catch (error) {
        console.error("Error fetching price group:", error);
        res.status(500).json({ message: "Failed to fetch price group" });
    }
};

export const createPriceGroup = async (req: Request, res: Response) => {
    const parsed = priceGroupInsertSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    try {
        const existingName = await db
            .select()
            .from(priceGroups)
            .where(eq(priceGroups.name, parsed.data.name))
            .then((res) => res[0]);

        if (existingName) {
            return res.status(409).json({ message: "Price group already exists" });
        }

        const [createdGroup] = await db
            .insert(priceGroups)
            .values(parsed.data)
            .returning();

        logAction(req, {
            action: "insert",
            table: "price_groups",
            data: createdGroup,
            userId: req.user!.id,
            msg: `created price group #${createdGroup.id}`,
        });

        return res.status(201).json({
            message: "Price group created successfully",
            createdGroup,
        });
    } catch (error) {
        console.error("error creating price group:", error);
        return res.status(500).json({ message: "Failed to create price group" });
    }
};

export const updatePriceGroup = async (req: Request, res: Response) => {
    const parsed = priceGroupUpdateSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    try {
        const oldGroup = await db
            .select()
            .from(priceGroups)
            .where(eq(priceGroups.id, parsed.data.id))
            .then((r) => r[0]);
        if (!oldGroup) return res.status(404).json({ message: "Price group not found" });

        const existingName = await db
            .select()
            .from(priceGroups)
            .where(eq(priceGroups.name, parsed.data.name ?? ""))
            .then((res) => res[0]);

        if (existingName && existingName.id !== parsed.data.id) {
            return res.status(409).json({ message: "Price group already exists" });
        }

        const [updatedGroup] = await db
            .update(priceGroups)
            .set(parsed.data)
            .where(eq(priceGroups.id, parsed.data.id))
            .returning();

        logAction(req, {
            action: "update",
            table: "price_groups",
            oldData: oldGroup,
            data: updatedGroup,
            userId: req.user!.id,
            msg: `updated price group #${updatedGroup.id}`,
        });

        return res.status(200).json({
            message: `${updatedGroup.name} updated successfully`,
            priceGroup: updatedGroup,
        });
    } catch (error) {
        console.error("Error updating price group:", error);
        return res.status(500).json({ message: "Failed to update price group" });
    }
};

export const getPaginatedPriceGroups = async (req: Request, res: Response) => {
    try {
        const query = req.query;

        const pageIndex = parseInt(query.pageIndex as string) || 0;
        const pageSize = parseInt(query.pageSize as string) || 5;
        const offset = pageIndex * pageSize;

        const search = (query.search as string) ?? "";
        const searchCondition = search
            ? or(like(sql`LOWER(${priceGroups.name})`, `%${search.toLowerCase()}%`))
            : undefined;

        const sortColumns: Record<string, PgColumn> = {
            name: priceGroups.name,
        };

        const sortKey = (query.sort as string) ?? "name";
        const order = (query.order as string) === "desc" ? "desc" : "asc";

        const sortColumn = sortColumns[sortKey] ?? priceGroups.name;

        const [priceGroupList, totalCount] = await Promise.all([
            db
                .select()
                .from(priceGroups)
                .where(searchCondition)
                .orderBy(order === "desc" ? desc(sortColumn) : asc(sortColumn))
                .limit(pageSize)
                .offset(offset),
            db
                .select({ count: sql<number>`count(*)` })
                .from(priceGroups)
                .where(searchCondition),
        ]);

        res.json({
            rows: priceGroupList,
            pageCount: Math.ceil(Number(totalCount[0]?.count || 0) / pageSize),
            rowCount: Number(totalCount[0]?.count || 0),
            pageIndex,
            pageSize,
            sort: sortKey,
            order,
        });
    } catch (error) {
        console.error("Error fetching price groups:", error);
        res.status(500).json({ message: "Failed to fetch price groups" });
    }
};
