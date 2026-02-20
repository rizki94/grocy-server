import { db } from "@/db";
import { warehouses } from "@/db/schemas";
import { logAction } from "@/utils/log-helper";
import { CacheService } from "@/services/cache-service";
import { warehouseInsertSchema, warehouseUpdateSchema } from "@/validators/warehouse.validator";
import { and, asc, desc, eq, like, or, sql } from "drizzle-orm";
import { PgColumn } from "drizzle-orm/pg-core";
import { Request, Response } from "express";

export async function getAllWarehouses(req: Request, res: Response) {
    try {
        const data = await CacheService.getOrSet("warehouses:all", 60, async () => {
            return db.select().from(warehouses).orderBy(warehouses.name);
        });
        res.status(200).json(data);
    } catch (error) {
        console.error("Error fetching warehouses:", error);
        res.status(500).json({ message: "Failed to fetch warehouses" });
    }
}

export async function getActiveWarehouses(req: Request, res: Response) {
    try {
        const data = await db
            .select()
            .from(warehouses)
            .where(eq(warehouses.isActive, true))
            .orderBy(warehouses.name);

        res.status(200).json(data);
    } catch (error) {
        console.error("Error fetching active warehouses:", error);
        res.status(500).json({ message: "Failed to fetch active warehouses" });
    }
}

export const getWarehouseById = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const [warehouse] = await db
            .select()
            .from(warehouses)
            .where(eq(warehouses.id, id))
            .limit(1);

        if (!warehouse) return res.status(404).json({ error: "Warehouse not found" });
        res.status(200).json(warehouse);
    } catch (error) {
        console.error("Error fetching warehouse:", error);
        res.status(500).json({ message: "Failed to fetch warehouse" });
    }
};

export const createWarehouse = async (req: Request, res: Response) => {
    const parsed = warehouseInsertSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    try {
        const existingName = await db
            .select()
            .from(warehouses)
            .where(eq(warehouses.name, parsed.data.name))
            .then((res) => res[0]);

        if (existingName) {
            return res.status(409).json({ message: "Warehouse already exists" });
        }

        const [createdWarehouse] = await db
            .insert(warehouses)
            .values(parsed.data)
            .returning();

        logAction(req, {
            action: "insert",
            table: "warehouses",
            data: createdWarehouse,
            userId: req.user!.id,
            msg: `created warehouse #${createdWarehouse.id}`,
        });

        return res.status(201).json({
            message: "Warehouse created successfully",
            createdWarehouse,
        });
    } catch (error) {
        console.error("error creating warehouse:", error);
        return res.status(500).json({ message: "Failed to create warehouse" });
    }
};

export const updateWarehouse = async (req: Request, res: Response) => {
    const parsed = warehouseUpdateSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    try {
        const oldWarehouse = await db
            .select()
            .from(warehouses)
            .where(eq(warehouses.id, parsed.data.id))
            .then((r) => r[0]);
        if (!oldWarehouse) return res.status(404).json({ message: "Warehouse not found" });

        const existingName = await db
            .select()
            .from(warehouses)
            .where(eq(warehouses.name, parsed.data.name ?? ""))
            .then((res) => res[0]);

        if (existingName && existingName.id !== parsed.data.id) {
            return res.status(409).json({ message: "Warehouse already exists" });
        }

        const [updatedWarehouse] = await db
            .update(warehouses)
            .set(parsed.data)
            .where(eq(warehouses.id, parsed.data.id))
            .returning();

        logAction(req, {
            action: "update",
            table: "warehouses",
            oldData: oldWarehouse,
            data: updatedWarehouse,
            userId: req.user!.id,
            msg: `updated warehouse #${updatedWarehouse.id}`,
        });

        return res.status(200).json({
            message: `${updatedWarehouse.name} updated successfully`,
            warehouse: updatedWarehouse,
        });
    } catch (error) {
        console.error("Error updating warehouse:", error);
        return res.status(500).json({ message: "Failed to update warehouse" });
    }
};

export const getPaginatedWarehouses = async (req: Request, res: Response) => {
    try {
        const query = req.query;

        const pageIndex = parseInt(query.pageIndex as string) || 0;
        const pageSize = parseInt(query.pageSize as string) || 5;
        const offset = pageIndex * pageSize;

        const search = (query.search as string) ?? "";
        const searchCondition = search
            ? or(like(sql`LOWER(${warehouses.name})`, `%${search.toLowerCase()}%`))
            : undefined;

        const sortColumns: Record<string, PgColumn> = {
            name: warehouses.name,
        };

        const sortKey = (query.sort as string) ?? "name";
        const order = (query.order as string) === "desc" ? "desc" : "asc";

        const sortColumn = sortColumns[sortKey] ?? warehouses.name;

        const [warehouseList, totalCount] = await Promise.all([
            db
                .select()
                .from(warehouses)
                .where(searchCondition)
                .orderBy(order === "desc" ? desc(sortColumn) : asc(sortColumn))
                .limit(pageSize)
                .offset(offset),
            db
                .select({ count: sql<number>`count(*)` })
                .from(warehouses)
                .where(searchCondition),
        ]);

        res.json({
            rows: warehouseList,
            pageCount: Math.ceil(Number(totalCount[0]?.count || 0) / pageSize),
            rowCount: Number(totalCount[0]?.count || 0),
            pageIndex,
            pageSize,
            sort: sortKey,
            order,
        });
    } catch (error) {
        console.error("Error fetching warehouses:", error);
        res.status(500).json({ message: "Failed to fetch warehouses" });
    }
};
