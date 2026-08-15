import { db } from "@/db";
import { contacts } from "@/db/schemas/contact.schema";
import { routeGroups } from "@/db/schemas/route-group.schema";
import { users } from "@/db/schemas/user.schema";
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
            latitude: c.latitude != null ? Number(c.latitude) : null,
            longitude: c.longitude != null ? Number(c.longitude) : null,
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
            latitude: user.latitude != null ? Number(user.latitude) : null,
            longitude: user.longitude != null ? Number(user.longitude) : null,
        };
        res.status(200).json(transformedUser);
    } catch (error) {
        console.error("Error fetching customer:", error);
        res.status(500).json({ message: "Failed to fetch customer" });
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
                latitude: parsed.data.latitude?.toString(),
                longitude: parsed.data.longitude?.toString(),
                contactType: "customer",
            })
            .returning();

        const transformedCustomer = {
            ...createdCustomer,
            creditLimit: createdCustomer.creditLimit ? Number(createdCustomer.creditLimit) : 0,
            latitude: createdCustomer.latitude != null ? Number(createdCustomer.latitude) : null,
            longitude: createdCustomer.longitude != null ? Number(createdCustomer.longitude) : null,
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

    const customer = parsed.data;

    try {
        const oldCustomer = await db
            .select()
            .from(contacts)
            .where(eq(contacts.id, customer.id))
            .then((r) => r[0]);
        if (!oldCustomer)
            return res.status(404).json({ message: "Customer not found" });

        const existingName = await db
            .select()
            .from(contacts)
            .where(eq(contacts.name, customer.name ?? ""))
            .then((res) => res[0]);

        if (existingName && existingName.id !== customer.id) {
            return res.status(409).json({ message: "Customer already exists" });
        }

        const [updatedCustomer] = await db
            .update(contacts)
            .set({
                ...customer,
                creditLimit: customer.creditLimit?.toString(),
                latitude: customer.latitude?.toString(),
                longitude: customer.longitude?.toString(),
                contactType: "customer",
            })
            .where(eq(contacts.id, customer.id))
            .returning();

        const transformedCustomer = {
            ...updatedCustomer,
            creditLimit: updatedCustomer.creditLimit ? Number(updatedCustomer.creditLimit) : 0,
            latitude: updatedCustomer.latitude != null ? Number(updatedCustomer.latitude) : null,
            longitude: updatedCustomer.longitude != null ? Number(updatedCustomer.longitude) : null,
        };

        logAction(req, {
            action: "update",
            table: "customers",
            oldData: oldCustomer,
            data: transformedCustomer,
            userId: req.user!.id,
            msg: `updated customer #${transformedCustomer.id}`,
        });

        return res.status(200).json({
            message: `${transformedCustomer.name} updated successfully`,
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
                        address: contacts.address,
                        termOfPayment: contacts.termOfPayment,
                        creditLimit: contacts.creditLimit,
                        phone: contacts.phone,
                        email: contacts.email,
                        priceGroupId: contacts.priceGroupId,
                        latitude: contacts.latitude,
                        longitude: contacts.longitude,
                        routeGroupId: contacts.routeGroupId,
                        salespersonId: contacts.salespersonId,
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
                    latitude: c.latitude != null ? Number(c.latitude) : null,
                    longitude: c.longitude != null ? Number(c.longitude) : null,
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
                .select({
                    id: contacts.id,
                    contactType: contacts.contactType,
                    name: contacts.name,
                    address: contacts.address,
                    phone: contacts.phone,
                    email: contacts.email,
                    termOfPayment: contacts.termOfPayment,
                    creditLimit: contacts.creditLimit,
                    invoiceLimit: contacts.invoiceLimit,
                    priceGroupId: contacts.priceGroupId,
                    latitude: contacts.latitude,
                    longitude: contacts.longitude,
                    routeGroupId: contacts.routeGroupId,
                    routeGroupName: routeGroups.name,
                    salespersonId: contacts.salespersonId,
                    salespersonName: users.displayName,
                    isActive: contacts.isActive,
                    createdAt: contacts.createdAt,
                    updatedAt: contacts.updatedAt,
                })
                .from(contacts)
                .leftJoin(routeGroups, eq(contacts.routeGroupId, routeGroups.id))
                .leftJoin(users, eq(contacts.salespersonId, users.id))
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
            latitude: c.latitude != null ? Number(c.latitude) : null,
            longitude: c.longitude != null ? Number(c.longitude) : null,
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
