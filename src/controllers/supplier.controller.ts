import { db } from "@/db";
import { contacts } from "@/db/schemas/contact.schema";
import { logAction } from "@/utils/log-helper";
import { CacheService } from "@/services/cache-service";
import {
    contactInsertSchema,
    contactUpdateSchema,
} from "@/validators/contact.validator";
import { and, asc, desc, eq, like, or, sql } from "drizzle-orm";
import { PgColumn } from "drizzle-orm/pg-core";
import { Request, Response } from "express";

export async function getAllSuppliers(req: Request, res: Response) {
    try {
        const data = await CacheService.getOrSet(
            "suppliers:all",
            60,
            async () => {
                return db
                    .select()
                    .from(contacts)
                    .where(eq(contacts.contactType, "supplier"))
                    .orderBy(contacts.name);
            },
        );
        const transformedData = data.map((c: any) => ({
            ...c,
            creditLimit: c.creditLimit ? Number(c.creditLimit) : 0,
        }));
        res.status(200).json(transformedData);
    } catch (error) {
        console.error("Error fetching suppliers:", error);
        res.status(500).json({ message: "Failed to fetch suppliers" });
    }
}
export async function getActiveSuppliers(req: Request, res: Response) {
    try {
        const data = await CacheService.getOrSet(
            "suppliers:active",
            60,
            async () => {
                return db
                    .select()
                    .from(contacts)
                    .where(
                        and(
                            eq(contacts.contactType, "supplier"),
                            eq(contacts.isActive, true),
                        ),
                    )
                    .orderBy(contacts.name);
            },
        );
        const transformedData = data.map((c: any) => ({
            ...c,
            creditLimit: c.creditLimit ? Number(c.creditLimit) : 0,
        }));
        res.status(200).json(transformedData);
    } catch (error) {
        console.error("Error fetching suppliers:", error);
        res.status(500).json({ message: "Failed to fetch suppliers" });
    }
}

export const getSupplierById = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const [user] = await db
            .select()
            .from(contacts)
            .where(eq(contacts.id, id))
            .limit(1);

        if (!user) return res.status(404).json({ error: "Supplier not found" });
        const transformedUser = {
            ...user,
            creditLimit: user.creditLimit ? Number(user.creditLimit) : 0,
        };
        res.status(200).json(transformedUser);
    } catch (error) {
        console.error("Error fetching suppliers:", error);
        res.status(500).json({ message: "Failed to fetch suppliers" });
    }
};

export const createSupplier = async (req: Request, res: Response) => {
    const parsed = contactInsertSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    const supplier = parsed.data;

    try {
        const existingName = await db
            .select()
            .from(contacts)
            .where(eq(contacts.name, supplier.name))
            .then((res) => res[0]);

        if (existingName) {
            return res.status(409).json({ message: "Supplier already exists" });
        }

        const [createdSupplier] = await db
            .insert(contacts)
            .values({
                ...supplier,
                creditLimit: supplier.creditLimit?.toString(),
                contactType: "supplier",
            })
            .returning();

        const transformedSupplier = {
            ...createdSupplier,
            creditLimit: createdSupplier.creditLimit ? Number(createdSupplier.creditLimit) : 0,
        };

        logAction(req, {
            action: "insert",
            table: "contacts",
            data: transformedSupplier,
            userId: req.user!.id,
            msg: `created supplier #${createdSupplier.id}`,
        });

        return res.status(201).json({
            message: "Supplier created successfully",
            createdSupplier: transformedSupplier,
        });
    } catch (error) {
        console.error("error creating supplier:", error);
        return res.status(500).json({ message: "Failed to create supplier" });
    }
};

export const updateSupplier = async (req: Request, res: Response) => {
    const parsed = contactUpdateSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    const supplier = parsed.data;

    try {
        const oldSupplier = await db
            .select()
            .from(contacts)
            .where(eq(contacts.id, supplier.id))
            .then((r) => r[0]);
        if (!oldSupplier)
            return res.status(404).json({ message: "Supplier not found" });

        const existingName = await db
            .select()
            .from(contacts)
            .where(eq(contacts.name, supplier.name ?? ""))
            .then((res) => res[0]);

        if (existingName && existingName.id !== supplier.id) {
            return res.status(409).json({ message: "Supplier already exists" });
        }

        const [updatedSupplier] = await db
            .update(contacts)
            .set({
                ...supplier,
                creditLimit: supplier.creditLimit?.toString(),
                contactType: "supplier",
            })
            .where(eq(contacts.id, supplier.id))
            .returning();

        const transformedSupplier = {
            ...updatedSupplier,
            creditLimit: updatedSupplier.creditLimit ? Number(updatedSupplier.creditLimit) : 0,
        };

        logAction(req, {
            action: "update",
            table: "suppliers",
            oldData: oldSupplier,
            data: transformedSupplier,
            userId: req.user!.id,
            msg: `updated supplier #${updatedSupplier.id}`,
        });

        return res.status(200).json({
            message: `${updatedSupplier.name} updated successfully`,
            supplier: transformedSupplier,
        });
    } catch (error) {
        console.error("Error updating supplier:", error);
        return res.status(500).json({ message: "Failed to update supplier" });
    }
};

export const getPaginatedSuppliers = async (req: Request, res: Response) => {
    try {
        const query = req.query;

        const pageIndex = parseInt(query.pageIndex as string) || 0;
        const pageSize = parseInt(query.pageSize as string) || 5;
        const offset = pageIndex * pageSize;

        const search = (query.search as string) ?? "";
        const searchCondition = search
            ? or(
                like(
                    sql`LOWER(${contacts.name})`,
                    `%${search.toLowerCase()}%`,
                ),
            )
            : undefined;

        const sortColumns: Record<string, PgColumn> = {
            name: contacts.name,
        };

        const sortKey = (query.sort as string) ?? "name";
        const order = (query.order as string) === "desc" ? "desc" : "asc";

        const sortColumn = sortColumns[sortKey] ?? contacts.name;

        const [supplierList, totalCount] = await Promise.all([
            db
                .select()
                .from(contacts)
                .where(
                    and(eq(contacts.contactType, "supplier"), searchCondition),
                )
                .orderBy(order === "desc" ? desc(sortColumn) : asc(sortColumn))
                .limit(pageSize)
                .offset(offset),
            db
                .select({ count: sql<number>`count(*)` })
                .from(contacts)
                .where(
                    and(eq(contacts.contactType, "supplier"), searchCondition),
                ),
        ]);

        const transformedRows = supplierList.map((c: any) => ({
            ...c,
            creditLimit: c.creditLimit ? Number(c.creditLimit) : 0,
        }));

        res.json({
            rows: transformedRows,
            pageCount: Math.ceil(Number(totalCount[0]?.count || 0) / pageSize),
            rowCount: Number(totalCount[0]?.count || 0),
            pageIndex,
            pageSize,
            sort: sortKey,
            order,
        });
    } catch (error) {
        console.error("Error fetching suppliers:", error);
        res.status(500).json({ message: "Failed to fetch suppliers" });
    }
};
