import { db } from "@/db";
import { asc, desc, eq, like, or, sql } from "drizzle-orm";
import { Request, Response } from "express";
import bcrypt from "bcrypt";
import { logAction } from "@/utils/log-helper";
import { CacheService } from "@/services/cache-service";
import { PgColumn } from "drizzle-orm/pg-core";
import { roles, users } from "@/db/schemas";
import {
    userInsertSchema,
    userUpdateSchema,
} from "@/validators/user.validator";

export const getAllUsers = async (req: Request, res: Response) => {
    try {
        const data = await CacheService.getOrSet("users:all", 60, async () => {
            return db.select().from(users).orderBy(users.username);
        });
        res.status(200).json(data);
    } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).json({ message: "Failed to fetch users" });
    }
};

export const getUserById = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const [user] = await db
            .select({
                id: users.id,
                username: users.username,
                roleId: users.roleId,
                isActive: users.isActive,
            })
            .from(users)
            .where(eq(users.id, id))
            .limit(1);

        if (!user) return res.status(404).json({ error: "User not found" });
        res.status(200).json(user);
    } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).json({ message: "Failed to fetch users" });
    }
};

export const createUser = async (req: Request, res: Response) => {
    const parsed = userInsertSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    const userData = parsed.data;

    try {
        const existingUser = await db
            .select()
            .from(users)
            .where(eq(users.username, userData.username))
            .then((res) => res[0]);

        if (existingUser) {
            return res.status(409).json({ message: "Username already exists" });
        }

        const [createdUser] = await db
            .insert(users)
            .values({
                ...userData,
                password: await bcrypt.hash(userData.password, 10),
            })
            .returning();

        logAction(req, {
            action: "insert",
            table: "users",
            data: createdUser,
            userId: req.user!.id,
            msg: `created user #${createdUser.id}`,
        });

        const { password, ...rest } = createdUser;

        return res.status(201).json({
            message: "User created successfully",
            rest,
        });
    } catch (error) {
        console.error("error creating user:", error);
        return res.status(500).json({ message: "Failed to create user" });
    }
};

export const updateUser = async (req: Request, res: Response) => {
    const parsed = userUpdateSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    if (!req.user) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    const { password, ...rest } = parsed.data;

    try {
        const oldUser = await db
            .select()
            .from(users)
            .where(eq(users.id, parsed.data.id))
            .then((r) => r[0]);
        if (!oldUser)
            return res.status(404).json({ message: "User not found" });

        const existingName = await db
            .select()
            .from(users)
            .where(eq(users.username, rest.username ?? ""))
            .then((res) => res[0]);
        if (existingName && existingName.id !== rest.id) {
            return res.status(409).json({ message: "Username already exists" });
        }

        const updateData = {
            ...rest,
            ...(password?.trim()
                ? { password: await bcrypt.hash(password, 10) }
                : {}),
        };

        const [updatedUser] = await db
            .update(users)
            .set(updateData)
            .where(eq(users.id, rest.id))
            .returning();

        const { password: _, ...safeUser } = updatedUser;

        logAction(req, {
            action: "update",
            table: "users",
            oldData: oldUser,
            data: updatedUser,
            userId: req.user!.id,
            msg: `updated user #${updatedUser.id}`,
        });

        return res.status(200).json({
            message: `${updatedUser.username} updated successfully`,
            user: safeUser,
        });
    } catch (error) {
        console.error("Error updating user:", error);
        return res.status(500).json({ message: "Failed to update user" });
    }
};

export const getPaginatedUsers = async (req: Request, res: Response) => {
    try {
        const query = req.query;

        const pageIndex = parseInt(query.pageIndex as string) || 0;
        const pageSize = parseInt(query.pageSize as string) || 5;
        const offset = pageIndex * pageSize;

        const search = (query.search as string) ?? "";
        const searchCondition = search
            ? or(
                  like(
                      sql`LOWER(${users.username})`,
                      `%${search.toLowerCase()}%`,
                  ),
              )
            : undefined;

        const sortColumns: Record<string, PgColumn> = {
            username: users.username,
            roleId: users.roleId,
            isActive: users.isActive,
        };

        const sortKey = (query.sort as string) ?? "username";
        const order = (query.order as string) === "desc" ? "desc" : "asc";

        const sortColumn = sortColumns[sortKey] ?? users.username;

        const [userList, totalCount] = await Promise.all([
            db
                .select({
                    id: users.id,
                    username: users.username,
                    role: roles.name,
                    isActive: users.isActive,
                })
                .from(users)
                .innerJoin(roles, eq(roles.id, users.roleId))
                .where(searchCondition)
                .orderBy(order === "desc" ? desc(sortColumn) : asc(sortColumn))
                .limit(pageSize)
                .offset(offset),
            db
                .select({ count: sql<number>`count(*)` })
                .from(users)
                .where(searchCondition),
        ]);

        res.json({
            rows: userList,
            pageCount: Math.ceil(Number(totalCount[0]?.count || 0) / pageSize),
            rowCount: Number(totalCount[0]?.count || 0),
            pageIndex,
            pageSize,
            sort: sortKey,
            order,
        });
    } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).json({ message: "Failed to fetch users" });
    }
};
