import { Request, Response } from "express";
import { db } from "@/db";
import { and, asc, desc, eq, like, or, sql } from "drizzle-orm";
import {
    productUnitInsertSchema,
    productUnitUpdateSchema,
} from "@/validators/product-unit.validator";
import { logAction } from "@/utils/log-helper";
import { PgColumn } from "drizzle-orm/pg-core";
import { CacheService } from "@/services/cache-service";
import { productUnits } from "@/db/schemas";

export async function getAllProductUnits(req: Request, res: Response) {
    try {
        const data = await CacheService.getOrSet(
            "product-units:all",
            60,
            async () => {
                return db
                    .select({
                        id: productUnits.id,
                        name: productUnits.name,
                        abbreviation: productUnits.abbreviation,
                    })
                    .from(productUnits)
                    .orderBy(productUnits.name);
            },
        );
        res.status(200).json(data);
    } catch (error) {
        console.error("Error fetching units:", error);
        res.status(500).json({ message: "Failed to fetch units" });
    }
}

export const getProductUnitById = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const [row] = await db
            .select()
            .from(productUnits)
            .where(eq(productUnits.id, id));
        if (!row) return res.status(404).json({ message: "Unit not found" });
        res.json(row);
    } catch (err) {
        console.error("Error fetching unit:", err);
        res.status(500).json({ message: "Failed to fetch unit" });
    }
};

export const createProductUnit = async (req: Request, res: Response) => {
    const parsed = productUnitInsertSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    const productUnit = parsed.data;

    try {
        const [createdUnit] = await db
            .insert(productUnits)
            .values(productUnit)
            .returning();
        res.status(201).json({
            message: "Unit created successfully",
            unit: createdUnit,
        });

        logAction(req, {
            action: "insert",
            table: "product_units",
            data: createdUnit,
            userId: req.user!.id,
            msg: `created unit #${createdUnit.id}`,
        });
    } catch (error) {
        console.error("error creating unit:", error);
        return res.status(500).json({ message: "Failed to create unit" });
    }
};

export const updateProductUnit = async (req: Request, res: Response) => {
    const parsed = productUnitUpdateSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    const productUnit = parsed.data;

    try {
        const oldProductUnit = await db
            .select()
            .from(productUnits)
            .where(eq(productUnits.id, productUnit.id))
            .then((r) => r[0]);
        if (!oldProductUnit)
            return res.status(404).json({ message: "Unit not found" });

        const existingName = await db
            .select()
            .from(productUnits)
            .where(eq(productUnits.name, productUnit.name ?? ""))
            .then((res) => res[0]);

        if (existingName && existingName.id !== productUnit.id) {
            return res.status(409).json({ message: "Unit already exists" });
        }

        const [updatedProductUnit] = await db
            .update(productUnits)
            .set(productUnit)
            .where(eq(productUnits.id, productUnit.id))
            .returning();

        logAction(req, {
            action: "update",
            table: "product_units",
            oldData: oldProductUnit,
            data: updatedProductUnit,
            userId: req.user!.id,
            msg: `updated unit #${updatedProductUnit.id}`,
        });

        return res.status(200).json({
            message: `${updatedProductUnit.name} updated successfully`,
            unit: updatedProductUnit,
        });
    } catch (error) {
        console.error("Error updating unit:", error);
        return res.status(500).json({ message: "Failed to update unit" });
    }
};

export const getPaginatedProductUnits = async (req: Request, res: Response) => {
    try {
        const query = req.query;

        const pageIndex = parseInt(query.pageIndex as string) || 0;
        const pageSize = parseInt(query.pageSize as string) || 5;
        const offset = pageIndex * pageSize;

        const search = (query.search as string) ?? "";
        const searchCondition = search
            ? or(
                  like(
                      sql`LOWER(${productUnits.name})`,
                      `%${search.toLowerCase()}%`,
                  ),
              )
            : undefined;

        const sortColumns: Record<string, PgColumn> = {
            name: productUnits.name,
        };

        const sortKey = (query.sort as string) ?? "name";
        const order = (query.order as string) === "desc" ? "desc" : "asc";

        const sortColumn = sortColumns[sortKey] ?? productUnits.name;

        const [productUnitList, totalCount] = await Promise.all([
            db
                .select()
                .from(productUnits)
                .where(searchCondition)
                .orderBy(order === "desc" ? desc(sortColumn) : asc(sortColumn))
                .limit(pageSize)
                .offset(offset),
            db
                .select({ count: sql<number>`count(*)` })
                .from(productUnits)
                .where(searchCondition),
        ]);

        res.json({
            rows: productUnitList,
            pageCount: Math.ceil(Number(totalCount[0]?.count || 0) / pageSize),
            rowCount: Number(totalCount[0]?.count || 0),
            pageIndex,
            pageSize,
            sort: sortKey,
            order,
        });
    } catch (error) {
        console.error("Error fetching units:", error);
        res.status(500).json({ message: "Failed to fetch units" });
    }
};
