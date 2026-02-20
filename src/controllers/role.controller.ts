import { db } from "@/db";
import { rolePermissions } from "@/db/schemas";
import { roles } from "@/db/schemas/role.schema";
import { logAction } from "@/utils/log-helper";
import { CacheService } from "@/services/cache-service";
import {
    roleInsertSchema,
    rolePermissionUpdateSchema,
    roleUpdateSchema,
} from "@/validators/role.validator";
import { and, asc, desc, eq, like, or, sql } from "drizzle-orm";
import { PgColumn } from "drizzle-orm/pg-core";
import { Request, Response } from "express";

export async function getAllRoles(req: Request, res: Response) {
    try {
        const data = await CacheService.getOrSet("roles:all", 60, async () => {
            return db.select().from(roles).orderBy(roles.name);
        });
        res.status(200).json(data);
    } catch (error) {
        console.error("Error fetching roles:", error);
        res.status(500).json({ message: "Failed to fetch roles" });
    }
}

export const getRoleById = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        const [role] = await db
            .select()
            .from(roles)
            .where(eq(roles.id, id))
            .limit(1);

        if (!role) {
            return res.status(404).json({ error: "Role not found" });
        }

        const permissions = await db
            .select({
                permissionId: rolePermissions.permissionId,
            })
            .from(rolePermissions)
            .where(eq(rolePermissions.roleId, id));

        const result = {
            id: role.id,
            name: role.name,
            isActive: true,
            permissions: permissions.map((p) => p.permissionId),
        };

        res.status(200).json(result);
    } catch (error) {
        console.error("Error fetching role:", error);
        res.status(500).json({ message: "Failed to fetch role" });
    }
};

export const createRole = async (req: Request, res: Response) => {
    const parsed = roleInsertSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    const { name, permissions } = parsed.data;

    try {
        const [newRole] = await db.insert(roles).values({ name }).returning();

        if (permissions?.length) {
            await db.insert(rolePermissions).values(
                permissions.map((pid) => ({
                    roleId: newRole.id,
                    permissionId: pid,
                    hasPermission: true,
                })),
            );
        }

        logAction(req, {
            action: "insert",
            table: "roles",
            data: { ...newRole, permissions: permissions ?? [] },
            userId: req.user!.id,
            msg: `created role #${newRole.id}`,
        });

        res.status(201).json({
            message: "Role created successfully",
            role: {
                ...newRole,
                permissions: permissions ?? [],
            },
        });
    } catch (error) {
        console.error("Error creating role:", error);
        res.status(500).json({ message: "Failed to create role" });
    }
};

export const updateRole = async (req: Request, res: Response) => {
    const parsed = roleUpdateSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    const { id, name, permissions } = parsed.data;

    try {
        const [updated] = await db
            .update(roles)
            .set({ name })
            .where(eq(roles.id, id))
            .returning();

        if (!updated) return res.status(404).json({ error: "Role not found" });

        await db.delete(rolePermissions).where(eq(rolePermissions.roleId, id));

        if (permissions?.length) {
            await db.insert(rolePermissions).values(
                permissions.map((pid) => ({
                    roleId: id,
                    permissionId: pid,
                    hasPermission: true,
                })),
            );
        }
        logAction(req, {
            action: "update",
            table: "roles",
            data: { ...updated, permissions },
            userId: req.user!.id,
            msg: `updated role #${id}`,
        });
        res.status(200).json({
            message: "Role updated successfully",
            role: {
                ...updated,
                permissions,
            },
        });
    } catch (error) {
        console.error("Error updating role:", error);
        res.status(500).json({ message: "Failed to update role" });
    }
};

export const updatePermissions = async (req: Request, res: Response) => {
    const parsed = rolePermissionUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
        const formatted = parsed.error.flatten();

        return res.status(400).json({
            message: "Validation failed",
            errors: formatted.fieldErrors,
        });
    }
    const { roleId, permissionId, hasPermission } = parsed.data;
    try {
        const existing = await db
            .select()
            .from(rolePermissions)
            .where(
                and(
                    eq(rolePermissions.roleId, roleId),
                    eq(rolePermissions.permissionId, permissionId),
                ),
            )
            .limit(1);
        if (existing.length > 0) {
            const record = existing[0];
            await db
                .update(rolePermissions)
                .set({
                    hasPermission,
                })
                .where(eq(rolePermissions.id, record.id));
            logAction(req, {
                action: "update",
                table: "role_permissions",
                oldData: record,
                data: { roleId, permissionId, hasPermission },
                userId: req.user!.id,
                msg: `updated permission for role #${roleId}`,
            });
            return res.status(201).json({
                message: "Permission updated successfully",
                roleId,
            });
        } else {
            const [newPerm] = await db
                .insert(rolePermissions)
                .values({
                    roleId,
                    permissionId,
                    hasPermission,
                })
                .returning();

            logAction(req, {
                action: "insert",
                table: "role_permissions",
                data: newPerm,
                userId: req.user!.id,
                msg: `assigned permission to role #${roleId}`,
            });

            return res.status(201).json({
                message: "Permission created successfully",
                roleId,
            });
        }
    } catch (error) {
        console.error("Error assigning permission to role:", error);
        res.status(500).json({
            message: "Failed to assign permission to role",
        });
    }
};

export const getPaginatedRoles = async (req: Request, res: Response) => {
    try {
        const query = req.query;

        const pageIndex = parseInt(query.pageIndex as string) || 0;
        const pageSize = parseInt(query.pageSize as string) || 5;
        const offset = pageIndex * pageSize;

        const search = (query.search as string) ?? "";
        const searchCondition = search
            ? or(like(sql`LOWER(${roles.name})`, `%${search.toLowerCase()}%`))
            : undefined;

        const sortColumns: Record<string, PgColumn> = {
            name: roles.name,
        };

        const sortKey = (query.sort as string) ?? "name";
        const order = (query.order as string) === "desc" ? "desc" : "asc";

        const sortColumn = sortColumns[sortKey] ?? roles.name;

        const [roleList, totalCount] = await Promise.all([
            db
                .select()
                .from(roles)
                .where(searchCondition)
                .orderBy(order === "desc" ? desc(sortColumn) : asc(sortColumn))
                .limit(pageSize)
                .offset(offset),
            db
                .select({ count: sql<number>`count(*)` })
                .from(roles)
                .where(searchCondition),
        ]);

        res.json({
            rows: roleList,
            pageCount: Math.ceil(Number(totalCount[0]?.count || 0) / pageSize),
            rowCount: Number(totalCount[0]?.count || 0),
            pageIndex,
            pageSize,
            sort: sortKey,
            order,
        });
    } catch (error) {
        console.error("Error fetching roles:", error);
        res.status(500).json({ message: "Failed to fetch roles" });
    }
};
