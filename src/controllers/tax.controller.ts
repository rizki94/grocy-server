import { db } from "@/db";
import { taxes } from "@/db/schemas/tax.schema";
import { logAction } from "@/utils/log-helper";
import { CacheService } from "@/services/cache-service";
import { taxInsertSchema, taxUpdateSchema } from "@/validators/tax.validator";
import { and, asc, desc, eq, like, or, sql } from "drizzle-orm";
import { PgColumn } from "drizzle-orm/pg-core";
import { Request, Response } from "express";

export async function getAllTaxes(req: Request, res: Response) {
    try {
        const data = await CacheService.getOrSet("taxes:all", 60, async () => {
            return db.select().from(taxes).orderBy(taxes.name);
        });
        res.status(200).json(data);
    } catch (error) {
        console.error("Error fetching taxes:", error);
        res.status(500).json({ message: "Failed to fetch taxes" });
    }
}

export const getTaxById = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const [user] = await db
            .select()
            .from(taxes)
            .where(eq(taxes.id, id))
            .limit(1);

        if (!user) return res.status(404).json({ error: "Tax not found" });
        res.status(200).json(user);
    } catch (error) {
        console.error("Error fetching tax:", error);
        res.status(500).json({ message: "Failed to fetch tax" });
    }
};

export const createTax = async (req: Request, res: Response) => {
    const parsed = taxInsertSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    try {
        const existingName = await db
            .select()
            .from(taxes)
            .where(eq(taxes.name, parsed.data.name))
            .then((res) => res[0]);

        if (existingName) {
            return res.status(409).json({ message: "Tax already exists" });
        }

        const [createdTax] = await db
            .insert(taxes)
            .values(parsed.data)
            .returning();

        logAction(req, {
            action: "insert",
            table: "taxes",
            data: createdTax,
            userId: req.user!.id,
            msg: `created tax #${createdTax.id}`,
        });

        return res.status(201).json({
            message: "Tax created successfully",
            createdTax,
        });
    } catch (error) {
        console.error("error creating tax:", error);
        return res.status(500).json({ message: "Failed to create tax" });
    }
};

export const updateTax = async (req: Request, res: Response) => {
    const parsed = taxUpdateSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    try {
        const oldTax = await db
            .select()
            .from(taxes)
            .where(eq(taxes.id, parsed.data.id))
            .then((r) => r[0]);
        if (!oldTax) return res.status(404).json({ message: "Tax not found" });

        const existingName = await db
            .select()
            .from(taxes)
            .where(eq(taxes.name, parsed.data.name ?? ""))
            .then((res) => res[0]);

        if (existingName && existingName.id !== parsed.data.id) {
            return res.status(409).json({ message: "Tax already exists" });
        }

        const [updatedTax] = await db
            .update(taxes)
            .set(parsed.data)
            .where(eq(taxes.id, parsed.data.id))
            .returning();

        logAction(req, {
            action: "update",
            table: "taxes",
            oldData: oldTax,
            data: updatedTax,
            userId: req.user!.id,
            msg: `updated tax #${updatedTax.id}`,
        });

        return res.status(200).json({
            message: `${updatedTax.name} updated successfully`,
            tax: updatedTax,
        });
    } catch (error) {
        console.error("Error updating tax:", error);
        return res.status(500).json({ message: "Failed to update tax" });
    }
};

export const getPaginatedTaxes = async (req: Request, res: Response) => {
    try {
        const query = req.query;

        const pageIndex = parseInt(query.pageIndex as string) || 0;
        const pageSize = parseInt(query.pageSize as string) || 5;
        const offset = pageIndex * pageSize;

        const search = (query.search as string) ?? "";
        const searchCondition = search
            ? or(like(sql`LOWER(${taxes.name})`, `%${search.toLowerCase()}%`))
            : undefined;

        const sortColumns: Record<string, PgColumn> = {
            name: taxes.name,
        };

        const sortKey = (query.sort as string) ?? "name";
        const order = (query.order as string) === "desc" ? "desc" : "asc";

        const sortColumn = sortColumns[sortKey] ?? taxes.name;

        const [taxList, totalCount] = await Promise.all([
            db
                .select()
                .from(taxes)
                .where(searchCondition)
                .orderBy(order === "desc" ? desc(sortColumn) : asc(sortColumn))
                .limit(pageSize)
                .offset(offset),
            db
                .select({ count: sql<number>`count(*)` })
                .from(taxes)
                .where(searchCondition),
        ]);

        res.json({
            rows: taxList,
            pageCount: Math.ceil(Number(totalCount[0]?.count || 0) / pageSize),
            rowCount: Number(totalCount[0]?.count || 0),
            pageIndex,
            pageSize,
            sort: sortKey,
            order,
        });
    } catch (error) {
        console.error("Error fetching taxes:", error);
        res.status(500).json({ message: "Failed to fetch taxes" });
    }
};
