import { db } from "@/db";
import { permissionGroups, permissions } from "@/db/schemas/permission.schema";
import { logAction } from "@/utils/log-helper";
import { CacheService } from "@/services/cache-service";
import {
    permissionGroupInsertSchema,
    permissionInsertSchema,
    permissionUpdateSchema,
} from "@/validators/permission.validator";
import { asc, desc, eq, like, or, sql } from "drizzle-orm";
import { PgColumn } from "drizzle-orm/pg-core";
import { Request, Response } from "express";

export async function getAllPermissions(req: Request, res: Response) {
    try {
        const data = await CacheService.getOrSet(
            "permissions:all",
            60,
            async () => {
                return db.select().from(permissions).orderBy(permissions.code);
            }
        );
        res.status(200).json(data);
    } catch (error) {
        console.error("Error fetching permissions:", error);
        res.status(500).json({ message: "Failed to fetch permissions" });
    }
}

export async function getPermissionGroups(req: Request, res: Response) {
    try {
        const rows = await db
            .select({
                groupId: permissionGroups.id,
                groupName: permissionGroups.name,
                permId: permissions.id,
                permCode: permissions.code,
                permDescription: permissions.description,
            })
            .from(permissionGroups)
            .leftJoin(permissions, eq(permissions.groupId, permissionGroups.id))
            .orderBy(permissionGroups.name, permissions.code);

        const grouped: Record<
            string,
            {
                id: string;
                name: string;
                permissions: {
                    id: string;
                    code: string;
                    description: string | null;
                }[];
            }
        > = {};

        for (const row of rows) {
            if (!grouped[row.groupId]) {
                grouped[row.groupId] = {
                    id: row.groupId,
                    name: row.groupName,
                    permissions: [],
                };
            }

            if (row.permId) {
                grouped[row.groupId].permissions.push({
                    id: row.permId,
                    code: row.permCode ?? "",
                    description: row.permDescription,
                });
            }
        }

        res.json(Object.values(grouped));
    } catch (error) {
        console.error("Error fetching permissions:", error);
        res.status(500).json({ message: "Failed to fetch permissions" });
    }
}

export const getPermissionById = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const [user] = await db
            .select()
            .from(permissions)
            .where(eq(permissions.id, id))
            .limit(1);

        if (!user)
            return res.status(404).json({ error: "Permission not found" });
        res.status(200).json(user);
    } catch (error) {
        console.error("Error fetching permissions:", error);
        res.status(500).json({ message: "Failed to fetch permissions" });
    }
};

export const createPermission = async (req: Request, res: Response) => {
    const parsed = permissionInsertSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    try {
        const existingCode = await db
            .select()
            .from(permissions)
            .where(eq(permissions.code, parsed.data.code))
            .then((res) => res[0]);

        if (existingCode) {
            return res
                .status(409)
                .json({ message: "Permission already exists" });
        }

        const [createdPermission] = await db
            .insert(permissions)
            .values(parsed.data)
            .returning();

        logAction(req, {
            action: "insert",
            table: "permissions",
            data: createdPermission,
            userId: req.user!.id,
            msg: `created permission #${createdPermission.id}`,
        });

        return res.status(201).json({
            message: "Permission created successfully",
            createdPermission,
        });
    } catch (error) {
        console.error("error creating permission:", error);
        return res.status(500).json({ message: "Failed to create permission" });
    }
};

export const createPermissionGroup = async (req: Request, res: Response) => {
    const parsed = permissionGroupInsertSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    try {
        const existingName = await db
            .select()
            .from(permissionGroups)
            .where(eq(permissionGroups.name, parsed.data.name))
            .then((res) => res[0]);

        if (existingName) {
            return res
                .status(409)
                .json({ message: "Permission already exists" });
        }

        const [createdPermission] = await db
            .insert(permissionGroups)
            .values(parsed.data)
            .returning();

        logAction(req, {
            action: "insert",
            table: "permisson-groups",
            data: createdPermission,
            userId: req.user!.id,
            msg: `created permission #${createdPermission.id}`,
        });

        return res.status(201).json({
            message: "Permission Group created successfully",
            createdPermission,
        });
    } catch (error) {
        console.error("Error creating permission group:", error);
        return res
            .status(500)
            .json({ message: "Failed to create permission group" });
    }
};

export const updatePermission = async (req: Request, res: Response) => {
    const parsed = permissionUpdateSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    try {
        const oldPermission = await db
            .select()
            .from(permissions)
            .where(eq(permissions.id, parsed.data.id))
            .then((r) => r[0]);
        if (!oldPermission)
            return res.status(404).json({ message: "Permission not found" });

        const existingCode = await db
            .select()
            .from(permissions)
            .where(eq(permissions.code, parsed.data.code ?? ""))
            .then((res) => res[0]);

        if (existingCode && existingCode.id !== parsed.data.id) {
            return res
                .status(409)
                .json({ message: "Permission already exists" });
        }

        const [updatedPermission] = await db
            .update(permissions)
            .set(parsed.data)
            .where(eq(permissions.id, parsed.data.id))
            .returning();

        logAction(req, {
            action: "update",
            table: "permissions",
            oldData: oldPermission,
            data: updatedPermission,
            userId: req.user!.id,
            msg: `updated permission #${updatedPermission.id}`,
        });

        return res.status(200).json({
            message: `${updatedPermission.code} updated successfully`,
            permission: updatedPermission,
        });
    } catch (error) {
        console.error("Error updating permission:", error);
        return res.status(500).json({ message: "Failed to update permission" });
    }
};

export const getPaginatedPermissions = async (req: Request, res: Response) => {
    try {
        const query = req.query;

        const pageIndex = parseInt(query.pageIndex as string) || 0;
        const pageSize = parseInt(query.pageSize as string) || 5;
        const offset = pageIndex * pageSize;

        const search = (query.search as string) ?? "";
        const searchCondition = search
            ? or(
                  like(
                      sql`LOWER(${permissions.code})`,
                      `%${search.toLowerCase()}%`
                  )
              )
            : undefined;

        const sortColumns: Record<string, PgColumn> = {
            code: permissions.code,
        };

        const sortKey = (query.sort as string) ?? "name";
        const order = (query.order as string) === "desc" ? "desc" : "asc";

        const sortColumn = sortColumns[sortKey] ?? permissions.code;

        const [permissionList, totalCount] = await Promise.all([
            db
                .select({
                    id: permissions.id,
                    code: permissions.code,
                    description: permissions.description,
                    groupName: permissionGroups.name,
                })
                .from(permissions)
                .innerJoin(
                    permissionGroups,
                    eq(permissions.groupId, permissionGroups.id)
                )
                .where(searchCondition)
                .orderBy(order === "desc" ? desc(sortColumn) : asc(sortColumn))
                .limit(pageSize)
                .offset(offset),
            db
                .select({ count: sql<number>`count(*)` })
                .from(permissions)
                .innerJoin(
                    permissionGroups,
                    eq(permissions.groupId, permissionGroups.id)
                )
                .where(searchCondition),
        ]);

        res.json({
            rows: permissionList,
            pageCount: Math.ceil(Number(totalCount[0]?.count || 0) / pageSize),
            rowCount: Number(totalCount[0]?.count || 0),
            pageIndex,
            pageSize,
            sort: sortKey,
            order,
        });
    } catch (error) {
        console.error("Error fetching permissions:", error);
        res.status(500).json({ message: "Failed to fetch permissions" });
    }
};
