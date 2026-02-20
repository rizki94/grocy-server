import { Request, Response } from "express";
import { db } from "@/db";
import { and, asc, desc, eq, like, or, sql } from "drizzle-orm";
import { productAttributes } from "@/db/schemas";
import {
    productAttributeInsertSchema,
    productAttributeUpdateSchema,
} from "@/validators/product-attribute.validator";
import { logAction } from "@/utils/log-helper";
import { PgColumn } from "drizzle-orm/pg-core";
import { CacheService } from "@/services/cache-service";

export const getAllProductAttributes = async (req: Request, res: Response) => {
    try {
        const data = await CacheService.getOrSet(
            "product-attributes:all",
            60,
            async () => {
                return db
                    .select({
                        id: productAttributes.id,
                        name: productAttributes.name,
                        label: productAttributes.label,
                        type: productAttributes.type,
                        options: productAttributes.options,
                    })
                    .from(productAttributes)
                    .orderBy(productAttributes.name);
            },
        );
        res.status(200).json(data);
    } catch (err) {
        console.error("Error fetching attributes:", err);
        res.status(500).json({ message: "Failed to fetch attributes" });
    }
};

export const getProductAttributeById = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const [row] = await db
            .select()
            .from(productAttributes)
            .where(eq(productAttributes.id, id));
        if (!row)
            return res.status(404).json({ message: "Attribute not found" });
        res.json(row);
    } catch (err) {
        console.error("Error fetching attribute:", err);
        res.status(500).json({ message: "Failed to fetch attribute" });
    }
};

export const createProductAttribute = async (req: Request, res: Response) => {
    const parsed = productAttributeInsertSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    const productAttribute = parsed.data;

    try {
        const [createdAttribute] = await db
            .insert(productAttributes)
            .values(productAttribute)
            .returning();
        res.status(201).json({
            message: "Attribute created successfully",
            attribute: createdAttribute,
        });

        logAction(req, {
            action: "insert",
            table: "product_attributes",
            data: createdAttribute,
            userId: req.user!.id,
            msg: `created attribute #${createdAttribute.id}`,
        });
    } catch (error) {
        console.error("error creating attribute:", error);
        return res.status(500).json({ message: "Failed to create attribute" });
    }
};

export const updateProductAttribute = async (req: Request, res: Response) => {
    const parsed = productAttributeUpdateSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    const productAttribute = parsed.data;

    try {
        const oldProductAttribute = await db
            .select()
            .from(productAttributes)
            .where(eq(productAttributes.id, productAttribute.id))
            .then((r) => r[0]);
        if (!oldProductAttribute)
            return res.status(404).json({ message: "Attribute not found" });

        const existingName = await db
            .select()
            .from(productAttributes)
            .where(eq(productAttributes.name, productAttribute.name ?? ""))
            .then((res) => res[0]);

        if (existingName && existingName.id !== productAttribute.id) {
            return res
                .status(409)
                .json({ message: "Attribute already exists" });
        }

        const [updatedProductAttribute] = await db
            .update(productAttributes)
            .set(productAttribute)
            .where(eq(productAttributes.id, productAttribute.id))
            .returning();

        logAction(req, {
            action: "update",
            table: "product_attributes",
            oldData: oldProductAttribute,
            data: updatedProductAttribute,
            userId: req.user!.id,
            msg: `updated attribute #${updatedProductAttribute.id}`,
        });

        return res.status(200).json({
            message: `${updatedProductAttribute.name} updated successfully`,
            attribute: updatedProductAttribute,
        });
    } catch (error) {
        console.error("Error updating attribute:", error);
        return res.status(500).json({ message: "Failed to update attribute" });
    }
};

export const getPaginatedProductAttributes = async (
    req: Request,
    res: Response,
) => {
    try {
        const query = req.query;

        const pageIndex = parseInt(query.pageIndex as string) || 0;
        const pageSize = parseInt(query.pageSize as string) || 5;
        const offset = pageIndex * pageSize;

        const search = (query.search as string) ?? "";
        const searchCondition = search
            ? or(
                  like(
                      sql`LOWER(${productAttributes.name})`,
                      `%${search.toLowerCase()}%`,
                  ),
              )
            : undefined;

        const sortColumns: Record<string, PgColumn> = {
            name: productAttributes.name,
        };

        const sortKey = (query.sort as string) ?? "name";
        const order = (query.order as string) === "desc" ? "desc" : "asc";

        const sortColumn = sortColumns[sortKey] ?? productAttributes.name;

        const [productAttributeList, totalCount] = await Promise.all([
            db
                .select()
                .from(productAttributes)
                .where(searchCondition)
                .orderBy(order === "desc" ? desc(sortColumn) : asc(sortColumn))
                .limit(pageSize)
                .offset(offset),
            db
                .select({ count: sql<number>`count(*)` })
                .from(productAttributes)
                .where(searchCondition),
        ]);

        res.json({
            rows: productAttributeList,
            pageCount: Math.ceil(Number(totalCount[0]?.count || 0) / pageSize),
            rowCount: Number(totalCount[0]?.count || 0),
            pageIndex,
            pageSize,
            sort: sortKey,
            order,
        });
    } catch (error) {
        console.error("Error fetching attributes:", error);
        res.status(500).json({ message: "Failed to fetch attributes" });
    }
};
