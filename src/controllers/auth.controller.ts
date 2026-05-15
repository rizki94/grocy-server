import { db } from "@/db";
import { permissions } from "@/db/schemas/permission.schema";
import { rolePermissions } from "@/db/schemas/role-permission.schema";
import { users } from "@/db/schemas";
import { logAction } from "@/utils/log-helper";
import { UserModel } from "@/validators/user.validator";
import type { NextFunction, Request, Response } from "express";
import passport from "passport";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";

export const login = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    passport.authenticate(
        "local",
        (err: unknown, user: UserModel | false, info: { message?: string }) => {
            if (err) {
                return res
                    .status(500)
                    .json({ message: "Internal server error", error: err });
            }

            if (!user) {
                return res
                    .status(401)
                    .json({ message: info?.message || "Invalid credentials" });
            }

            req.logIn(user, (err) => {
                if (err) {
                    return res
                        .status(500)
                        .json({ message: "Login failed", error: err });
                }

                logAction(req, {
                    action: "login",
                    table: "users",
                    data: {
                        userId: user.id,
                        username: user.username,
                        ip: req.ip,
                        userAgent: req.get("User-Agent"),
                        timestamp: new Date().toISOString(),
                    },
                    userId: user.id,
                    msg: `logged in user #${user.id}`,
                });

                return res.status(200).json({
                    message: "Login success",
                    user: {
                        id: user.id,
                        username: user.username,
                    },
                });
            });
        }
    )(req, res, next);
};

export const logout = async (req: Request, res: Response) => {
    req.logout(() => {
        res.send("Logged out");
    });
};

export const loginNative = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    passport.authenticate(
        "local",
        async (err: unknown, user: UserModel | false, info: { message?: string }) => {
            if (err) {
                return res
                    .status(500)
                    .json({ status: 500, message: "Internal server error" });
            }

            if (!user) {
                return res
                    .status(401)
                    .json({ status: 401, message: info?.message || "Invalid credentials" });
            }

            const token = jwt.sign(
                {
                    id: user.id,
                    username: user.username,
                    roleId: user.roleId,
                    isActive: user.isActive,
                },
                process.env.JWT_SECRET || "secret",
                { expiresIn: (process.env.JWT_EXPIRES_IN as any) || "7d" }
            );

            // Fetch permissions for the response
            const rows = await db
                .select({
                    code: permissions.code,
                    hasPermission: rolePermissions.hasPermission,
                })
                .from(rolePermissions)
                .innerJoin(
                    permissions,
                    eq(rolePermissions.permissionId, permissions.id)
                )
                .where(eq(rolePermissions.roleId, user.roleId));

            const allowedPermissions = rows
                .filter((row) => row.hasPermission)
                .map((row) => row.code);

            return res.status(200).json({
                status: 200,
                message: "Login success",
                token,
                user: {
                    id: user.id,
                    username: user.username,
                    roleId: user.roleId,
                },
                permission: allowedPermissions,
            });
        }
    )(req, res, next);
};
export const refresh = async (req: Request, res: Response) => {
    const { id } = req.query;

    if (!id) {
        return res.status(400).json({ status: 400, message: "ID is required" });
    }

    try {
        const [user] = await db
            .select()
            .from(users)
            .where(eq(users.id, id as string))
            .limit(1);

        if (!user) {
            return res.status(404).json({ status: 404, message: "User not found" });
        }

        // Fetch permissions
        const rows = await db
            .select({
                code: permissions.code,
                hasPermission: rolePermissions.hasPermission,
            })
            .from(rolePermissions)
            .innerJoin(
                permissions,
                eq(rolePermissions.permissionId, permissions.id)
            )
            .where(eq(rolePermissions.roleId, user.roleId));

        const allowedPermissions = rows
            .filter((row) => row.hasPermission)
            .map((row) => row.code);

        // Generate new token if needed, or just return user info
        // Client expects { status: 200, user: ..., token: ..., permission: ... }
        const token = jwt.sign(
            {
                id: user.id,
                username: user.username,
                roleId: user.roleId,
                isActive: user.isActive,
            },
            process.env.JWT_SECRET || "secret",
            { expiresIn: (process.env.JWT_EXPIRES_IN as any) || "7d" }
        );

        return res.status(200).json({
            status: 200,
            message: "Refresh success",
            token,
            user: {
                id: user.id,
                username: user.username,
                roleId: user.roleId,
            },
            permission: allowedPermissions,
        });
    } catch (error) {
        console.error("Refresh error:", error);
        res.status(500).json({ status: 500, message: "Internal server error" });
    }
};
