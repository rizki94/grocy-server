import { db } from "@/db";
import { permissions } from "@/db/schemas/permission.schema";
import { rolePermissions } from "@/db/schemas/role-permission.schema";
import { sessions, users } from "@/db/schemas";
import { logAction } from "@/utils/log-helper";
import { UserModel } from "@/validators/user.validator";
import {
    getClientIp,
    parseUserAgentHint,
    type SessionMeta,
} from "@/helpers/session.helper";
import type { NextFunction, Request, Response } from "express";
import passport from "passport";
import jwt from "jsonwebtoken";
import { and, eq, gt, ne, sql } from "drizzle-orm";

export const login = async (
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
                    .json({ message: "Internal server error", error: err });
            }

            if (!user) {
                return res
                    .status(401)
                    .json({ message: info?.message || "Invalid credentials" });
            }

            // Enforce single active device session per user
            try {
                const existingSessions = await db
                    .select({
                        sid: sessions.sid,
                        sess: sessions.sess,
                        expire: sessions.expire,
                    })
                    .from(sessions)
                    .where(
                        and(
                            sql`${sessions.sess}->'passport'->>'user' = ${user.id}`,
                            gt(sessions.expire, new Date()),
                            ne(sessions.sid, req.sessionID || ""),
                        )
                    );

                if (existingSessions.length > 0) {
                    const existingMeta = (existingSessions[0].sess as any)
                        ?.meta as SessionMeta | undefined;

                    logAction(req, {
                        action: "login",
                        table: "sessions",
                        data: {
                            userId: user.id,
                            username: user.username,
                            blocked: true,
                            reason: "USER_ALREADY_LOGGED_IN",
                            existingSid: existingSessions[0].sid,
                        },
                        userId: user.id,
                        msg: `blocked login for "${user.username}": already logged in on another device`,
                    });

                    return res.status(409).json({
                        code: "USER_ALREADY_LOGGED_IN",
                        message:
                            "This account is already logged in on another device. Please log out from the other device first before logging in here.",
                        activeSession: {
                            device: parseUserAgentHint(existingMeta?.userAgent),
                            ip: existingMeta?.ip || null,
                            loginAt: existingMeta?.loginAt || null,
                            lastActivityAt: existingMeta?.lastActivityAt || null,
                        },
                    });
                }
            } catch (checkErr) {
                return res.status(500).json({
                    message: "Failed to verify active sessions",
                    error: checkErr,
                });
            }

            req.logIn(user, (err) => {
                if (err) {
                    return res
                        .status(500)
                        .json({ message: "Login failed", error: err });
                }

                const nowIso = new Date().toISOString();
                const ip = getClientIp(req);
                const userAgent = req.get("User-Agent") || "unknown";

                (req.session as typeof req.session & { meta?: SessionMeta }).meta = {
                    userId: user.id,
                    username: user.username,
                    ip,
                    userAgent,
                    loginAt: nowIso,
                    lastActivityAt: nowIso,
                };

                req.session.save((saveErr) => {
                    if (saveErr) {
                        return res.status(500).json({
                            message: "Failed to persist session",
                            error: saveErr,
                        });
                    }

                    logAction(req, {
                        action: "login",
                        table: "users",
                        data: {
                            userId: user.id,
                            username: user.username,
                            ip,
                            userAgent,
                            timestamp: nowIso,
                        },
                        userId: user.id,
                        msg: `logged in user "${user.username}"`,
                    });

                    return res.status(200).json({
                        message: "Login success",
                        user: {
                            id: user.id,
                            username: user.username,
                        },
                    });
                });
            });
        }
    )(req, res, next);
};

export const logout = async (req: Request, res: Response) => {
    const activeUser = req.user as { id?: string; username?: string } | undefined;
    const sid = req.sessionID;

    req.logout((logoutErr) => {
        if (logoutErr) {
            return res
                .status(500)
                .json({ message: "Logout failed", error: logoutErr });
        }

        if (!req.session) {
            res.clearCookie("connect.sid");
            return res.status(200).json({ message: "Logged out" });
        }

        req.session.destroy((destroyErr) => {
            res.clearCookie("connect.sid");
            if (destroyErr) {
                return res.status(500).json({
                    message: "Failed to destroy session",
                    error: destroyErr,
                });
            }

            if (activeUser?.id) {
                logAction(req, {
                    action: "logout",
                    table: "sessions",
                    data: {
                        userId: activeUser.id,
                        username: activeUser.username,
                        sid,
                    },
                    userId: activeUser.id,
                    msg: `logged out user "${activeUser.username}"`,
                });
            }

            return res.status(200).json({ message: "Logged out" });
        });
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
