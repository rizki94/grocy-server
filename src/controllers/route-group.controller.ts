import { db } from "@/db";
import { routeGroups } from "@/db/schemas";
import { logAction } from "@/utils/log-helper";
import { CacheService } from "@/services/cache-service";
import { routeGroupInsertSchema, routeGroupUpdateSchema } from "@/validators/route-group.validator";
import { and, asc, desc, eq, like, or, sql } from "drizzle-orm";
import { PgColumn } from "drizzle-orm/pg-core";
import { Request, Response } from "express";

export async function getAllRouteGroups(req: Request, res: Response) {
    try {
        const data = await CacheService.getOrSet("routeGroups:all", 60, async () => {
            return db.select().from(routeGroups).orderBy(routeGroups.name);
        });
        res.status(200).json(data);
    } catch (error) {
        console.error("Error fetching route groups:", error);
        res.status(500).json({ message: "Failed to fetch route groups" });
    }
}

export async function getActiveRouteGroups(req: Request, res: Response) {
    try {
        const data = await db
            .select()
            .from(routeGroups)
            .where(eq(routeGroups.isActive, true))
            .orderBy(routeGroups.name);

        res.status(200).json(data);
    } catch (error) {
        console.error("Error fetching active route groups:", error);
        res.status(500).json({ message: "Failed to fetch active route groups" });
    }
}

export const getRouteGroupById = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const [routeGroup] = await db
            .select()
            .from(routeGroups)
            .where(eq(routeGroups.id, id))
            .limit(1);

        if (!routeGroup) return res.status(404).json({ error: "Route group not found" });
        res.status(200).json(routeGroup);
    } catch (error) {
        console.error("Error fetching route group:", error);
        res.status(500).json({ message: "Failed to fetch route group" });
    }
};

export const createRouteGroup = async (req: Request, res: Response) => {
    const parsed = routeGroupInsertSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    try {
        const existingName = await db
            .select()
            .from(routeGroups)
            .where(eq(routeGroups.name, parsed.data.name))
            .then((res) => res[0]);

        if (existingName) {
            return res.status(409).json({ message: "Route group already exists" });
        }

        const [createdGroup] = await db
            .insert(routeGroups)
            .values(parsed.data)
            .returning();

        logAction(req, {
            action: "insert",
            table: "route_groups",
            data: createdGroup,
            userId: req.user!.id,
            msg: `created route group #${createdGroup.id}`,
        });

        return res.status(201).json({
            message: "Route group created successfully",
            createdGroup,
        });
    } catch (error) {
        console.error("error creating route group:", error);
        return res.status(500).json({ message: "Failed to create route group" });
    }
};

export const updateRouteGroup = async (req: Request, res: Response) => {
    const parsed = routeGroupUpdateSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    try {
        const oldGroup = await db
            .select()
            .from(routeGroups)
            .where(eq(routeGroups.id, parsed.data.id))
            .then((r) => r[0]);
        if (!oldGroup) return res.status(404).json({ message: "Route group not found" });

        const existingName = await db
            .select()
            .from(routeGroups)
            .where(eq(routeGroups.name, parsed.data.name ?? ""))
            .then((res) => res[0]);

        if (existingName && existingName.id !== parsed.data.id) {
            return res.status(409).json({ message: "Route group already exists" });
        }

        const [updatedGroup] = await db
            .update(routeGroups)
            .set(parsed.data)
            .where(eq(routeGroups.id, parsed.data.id))
            .returning();

        logAction(req, {
            action: "update",
            table: "route_groups",
            oldData: oldGroup,
            data: updatedGroup,
            userId: req.user!.id,
            msg: `updated route group #${updatedGroup.id}`,
        });

        return res.status(200).json({
            message: `${updatedGroup.name} updated successfully`,
            routeGroup: updatedGroup,
        });
    } catch (error) {
        console.error("Error updating route group:", error);
        return res.status(500).json({ message: "Failed to update route group" });
    }
};

export const getPaginatedRouteGroups = async (req: Request, res: Response) => {
    try {
        const query = req.query;

        const pageIndex = parseInt(query.pageIndex as string) || 0;
        const pageSize = parseInt(query.pageSize as string) || 5;
        const offset = pageIndex * pageSize;

        const search = (query.search as string) ?? "";
        const searchCondition = search
            ? or(like(sql`LOWER(${routeGroups.name})`, `%${search.toLowerCase()}%`))
            : undefined;

        const sortColumns: Record<string, PgColumn> = {
            name: routeGroups.name,
        };

        const sortKey = (query.sort as string) ?? "name";
        const order = (query.order as string) === "desc" ? "desc" : "asc";

        const sortColumn = sortColumns[sortKey] ?? routeGroups.name;

        const [routeGroupList, totalCount] = await Promise.all([
            db
                .select()
                .from(routeGroups)
                .where(searchCondition)
                .orderBy(order === "desc" ? desc(sortColumn) : asc(sortColumn))
                .limit(pageSize)
                .offset(offset),
            db
                .select({ count: sql<number>`count(*)` })
                .from(routeGroups)
                .where(searchCondition),
        ]);

        res.json({
            rows: routeGroupList,
            pageCount: Math.ceil(Number(totalCount[0]?.count || 0) / pageSize),
            rowCount: Number(totalCount[0]?.count || 0),
            pageIndex,
            pageSize,
            sort: sortKey,
            order,
        });
    } catch (error) {
        console.error("Error fetching route groups:", error);
        res.status(500).json({ message: "Failed to fetch route groups" });
    }
};
