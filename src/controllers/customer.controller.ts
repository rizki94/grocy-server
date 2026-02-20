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

export async function getAllCustomers(req: Request, res: Response) {
    try {
        const data = await CacheService.getOrSet(
            "customers:all",
            60,
            async () => {
                return db
                    .select()
                    .from(contacts)
                    .where(eq(contacts.contactType, "customer"))
                    .orderBy(contacts.name);
            },
        );
        const transformedData = data.map((c: any) => ({
            ...c,
            creditLimit: c.creditLimit ? Number(c.creditLimit) : 0,
        }));
        res.status(200).json(transformedData);
    } catch (error) {
        console.error("Error fetching customers:", error);
        res.status(500).json({ message: "Failed to fetch customers" });
    }
}

export const getCustomerById = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const [user] = await db
            .select()
            .from(contacts)
            .where(eq(contacts.id, id))
            .limit(1);

        if (!user) return res.status(404).json({ error: "Customer not found" });
        const transformedUser = {
            ...user,
            creditLimit: user.creditLimit ? Number(user.creditLimit) : 0,
        };
        res.status(200).json(transformedUser);
    } catch (error) {
        console.error("Error fetching customers:", error);
        res.status(500).json({ message: "Failed to fetch customers" });
    }
};

export const createCustomer = async (req: Request, res: Response) => {
    const parsed = contactInsertSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    try {
        const existingName = await db
            .select()
            .from(contacts)
            .where(eq(contacts.name, parsed.data.name))
            .then((res) => res[0]);

        if (existingName) {
            return res.status(409).json({ message: "Customer already exists" });
        }

        const [createdCustomer] = await db
            .insert(contacts)
            .values({
                ...parsed.data,
                creditLimit: parsed.data.creditLimit?.toString(),
                contactType: "customer",
            })
            .returning();

        const transformedCustomer = {
            ...createdCustomer,
            creditLimit: createdCustomer.creditLimit ? Number(createdCustomer.creditLimit) : 0,
        };

        logAction(req, {
            action: "insert",
            table: "contacts",
            data: transformedCustomer,
            userId: req.user!.id,
            msg: `created customer #${createdCustomer.id}`,
        });

        return res.status(201).json({
            message: "Customer created successfully",
            createdCustomer: transformedCustomer,
        });
    } catch (error) {
        console.error("error creating customer:", error);
        return res.status(500).json({ message: "Failed to create customer" });
    }
};

export const updateCustomer = async (req: Request, res: Response) => {
    const parsed = contactUpdateSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    try {
        const oldCustomer = await db
            .select()
            .from(contacts)
            .where(eq(contacts.id, parsed.data.id))
            .then((r) => r[0]);
        if (!oldCustomer)
            return res.status(404).json({ message: "Customer not found" });

        const existingName = await db
            .select()
            .from(contacts)
            .where(eq(contacts.name, parsed.data.name ?? ""))
            .then((res) => res[0]);

        if (existingName && existingName.id !== parsed.data.id) {
            return res.status(409).json({ message: "Customer already exists" });
        }

        const [updatedCustomer] = await db
            .update(contacts)
            .set({
                ...parsed.data,
                creditLimit: parsed.data.creditLimit?.toString()
            })
            .where(eq(contacts.id, parsed.data.id))
            .returning();

        const transformedCustomer = {
            ...updatedCustomer,
            creditLimit: updatedCustomer.creditLimit ? Number(updatedCustomer.creditLimit) : 0,
        };

        logAction(req, {
            action: "update",
            table: "contacts",
            oldData: oldCustomer,
            data: transformedCustomer,
            userId: req.user!.id,
            msg: `updated customer #${updatedCustomer.id}`,
        });

        return res.status(200).json({
            message: `${updatedCustomer.name} updated successfully`,
            customer: transformedCustomer,
        });
    } catch (error) {
        console.error("Error updating customer:", error);
        return res.status(500).json({ message: "Failed to update customer" });
    }
};

export const getActiveCustomers = async (req: Request, res: Response) => {
    try {
        const data = await CacheService.getOrSet(
            "customers:active",
            60,
            async () => {
                const results = await db
                    .select({
                        id: contacts.id,
                        name: contacts.name,
                        termOfPayment: contacts.termOfPayment,
                        priceGroupId: contacts.priceGroupId,
                        creditLimit: contacts.creditLimit,
                    })
                    .from(contacts)
                    .where(
                        and(
                            eq(contacts.contactType, "customer"),
                            eq(contacts.isActive, true),
                        ),
                    )
                    .orderBy(contacts.name);
                return results.map((c: any) => ({
                    ...c,
                    creditLimit: c.creditLimit ? Number(c.creditLimit) : 0,
                }));
            },
        );
        res.status(200).json(data);
    } catch (error) {
        console.error("Error fetching active customers:", error);
        res.status(500).json({ message: "Failed to fetch active customers" });
    }
};

export const getPaginatedCustomers = async (req: Request, res: Response) => {
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

        const [customerList, totalCount] = await Promise.all([
            db
                .select()
                .from(contacts)
                .where(
                    and(eq(contacts.contactType, "customer"), searchCondition),
                )
                .orderBy(order === "desc" ? desc(sortColumn) : asc(sortColumn))
                .limit(pageSize)
                .offset(offset),
            db
                .select({ count: sql<number>`count(*)` })
                .from(contacts)
                .where(
                    and(eq(contacts.contactType, "customer"), searchCondition),
                ),
        ]);

        const transformedRows = customerList.map((c: any) => ({
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
        console.error("Error fetching customers:", error);
        res.status(500).json({ message: "Failed to fetch customers" });
    }
};
