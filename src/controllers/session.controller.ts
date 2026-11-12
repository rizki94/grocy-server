import { db } from "@/db";
import { branches, roles, sessions, users } from "@/db/schemas";
import { parseUserAgentHint, type SessionMeta } from "@/helpers/session.helper";
import { logAction } from "@/utils/log-helper";
import { eq, inArray, sql } from "drizzle-orm";
import type { Request, Response } from "express";

interface ActiveSessionRow {
    sid: string;
    isCurrentSession: boolean;
    userId: string;
    username: string;
    displayName: string | null;
    avatar: string | null;
    roleName: string | null;
    branchName: string | null;
    ip: string;
    userAgent: string;
    deviceLabel: string;
    loginAt: string | null;
    lastActivityAt: string | null;
    idleSeconds: number;
    status: "active" | "idle";
    expire: string;
}

async function fetchEnrichedActiveSessions(
    currentSid: string | undefined,
    idleThresholdSeconds: number,
): Promise<ActiveSessionRow[]> {
    const now = Date.now();

    const activeRaw = await db
        .select({
            sid: sessions.sid,
            sess: sessions.sess,
            expire: sessions.expire,
        })
        .from(sessions)
        .where(
            sql`${sessions.sess}->'passport'->>'user' IS NOT NULL AND ${sessions.expire} > NOW()`,
        );

    if (activeRaw.length === 0) return [];

    const userIds = Array.from(
        new Set(
            activeRaw
                .map((r) => (r.sess as any)?.passport?.user as string | undefined)
                .filter((id): id is string => Boolean(id)),
        ),
    );

    const userRows =
        userIds.length > 0
            ? await db
                  .select({
                      id: users.id,
                      username: users.username,
                      displayName: users.displayName,
                      avatar: users.avatar,
                      roleName: roles.name,
                      branchName: branches.name,
                  })
                  .from(users)
                  .leftJoin(roles, eq(users.roleId, roles.id))
                  .leftJoin(branches, eq(users.branchId, branches.id))
                  .where(inArray(users.id, userIds))
            : [];

    const userMap = new Map(userRows.map((u) => [u.id, u]));

    return activeRaw.map((row) => {
        const sessObj = (row.sess || {}) as {
            passport?: { user?: string };
            meta?: SessionMeta;
        };
        const userId = sessObj.passport?.user || "";
        const userInfo = userMap.get(userId);
        const meta = sessObj.meta;

        const lastActivityStr = meta?.lastActivityAt || meta?.loginAt || null;
        const lastActivityMs = lastActivityStr
            ? new Date(lastActivityStr).getTime()
            : now;
        const idleSeconds = Number.isFinite(lastActivityMs)
            ? Math.max(0, Math.floor((now - lastActivityMs) / 1000))
            : 0;

        const userAgent = meta?.userAgent || "unknown";

        return {
            sid: row.sid,
            isCurrentSession: row.sid === currentSid,
            userId,
            username: userInfo?.username || meta?.username || "unknown",
            displayName: userInfo?.displayName || null,
            avatar: userInfo?.avatar || null,
            roleName: userInfo?.roleName || null,
            branchName: userInfo?.branchName || null,
            ip: meta?.ip || "unknown",
            userAgent,
            deviceLabel: parseUserAgentHint(userAgent),
            loginAt: meta?.loginAt || null,
            lastActivityAt: lastActivityStr,
            idleSeconds,
            status: idleSeconds >= idleThresholdSeconds ? "idle" : "active",
            expire:
                row.expire instanceof Date
                    ? row.expire.toISOString()
                    : String(row.expire),
        };
    });
}

export async function getActiveSessions(req: Request, res: Response) {
    try {
        const pageIndex = Math.max(0, parseInt(String(req.query.pageIndex || "0"), 10) || 0);
        const pageSize = Math.max(1, parseInt(String(req.query.pageSize || "10"), 10) || 10);
        const search = String(req.query.search || "").trim().toLowerCase();
        const statusFilter = String(req.query.status || "all").toLowerCase();
        const idleMinutes = Math.max(1, parseInt(String(req.query.idleMinutes || "15"), 10) || 15);
        const sortField = String(req.query.sort || "idleSeconds");
        const sortOrder = String(req.query.order || "desc").toLowerCase() === "asc" ? 1 : -1;

        const allSessions = await fetchEnrichedActiveSessions(
            req.sessionID,
            idleMinutes * 60,
        );

        const summary = {
            totalCount: allSessions.length,
            activeCount: allSessions.filter((s) => s.status === "active").length,
            idleCount: allSessions.filter((s) => s.status === "idle").length,
        };

        let filtered = allSessions;

        if (statusFilter === "active" || statusFilter === "idle") {
            filtered = filtered.filter((s) => s.status === statusFilter);
        }

        if (search) {
            filtered = filtered.filter(
                (s) =>
                    s.username.toLowerCase().includes(search) ||
                    (s.displayName || "").toLowerCase().includes(search) ||
                    (s.roleName || "").toLowerCase().includes(search) ||
                    (s.branchName || "").toLowerCase().includes(search) ||
                    s.ip.toLowerCase().includes(search) ||
                    s.deviceLabel.toLowerCase().includes(search),
            );
        }

        filtered.sort((a, b) => {
            const valA = (a as any)[sortField];
            const valB = (b as any)[sortField];
            if (typeof valA === "number" && typeof valB === "number") {
                return (valA - valB) * sortOrder;
            }
            return String(valA ?? "").localeCompare(String(valB ?? "")) * sortOrder;
        });

        const rowCount = filtered.length;
        const pageCount = Math.max(1, Math.ceil(rowCount / pageSize));
        const start = pageIndex * pageSize;
        const rows = filtered.slice(start, start + pageSize);

        return res.status(200).json({
            rows,
            rowCount,
            pageCount,
            summary,
            idleMinutes,
        });
    } catch (error) {
        console.error("Failed to fetch active sessions:", error);
        return res.status(500).json({
            message: "Failed to fetch active sessions",
            error: (error as Error).message,
        });
    }
}

export async function forceLogoutSession(req: Request, res: Response) {
    try {
        const { sid } = req.params;
        if (!sid) {
            return res.status(400).json({ message: "Session ID is required" });
        }

        if (sid === req.sessionID) {
            return res.status(400).json({
                message: "Cannot force logout your own current session",
            });
        }

        const [target] = await db
            .select({ sid: sessions.sid, sess: sessions.sess })
            .from(sessions)
            .where(eq(sessions.sid, sid))
            .limit(1);

        if (!target) {
            return res.status(404).json({ message: "Session not found" });
        }

        await db.delete(sessions).where(eq(sessions.sid, sid));

        const targetMeta = (target.sess as any)?.meta as SessionMeta | undefined;
        const targetUserId = (target.sess as any)?.passport?.user;

        logAction(req, {
            action: "logout",
            table: "sessions",
            id: sid,
            data: {
                targetSid: sid,
                targetUserId,
                targetUsername: targetMeta?.username,
                forcedBy: req.user?.id,
            },
            userId: req.user?.id,
            msg: `SysAdmin force-logged out user "${targetMeta?.username || targetUserId || sid}"`,
        });

        return res.status(200).json({
            message: "Session terminated successfully",
            sid,
        });
    } catch (error) {
        console.error("Failed to force logout session:", error);
        return res.status(500).json({
            message: "Failed to force logout session",
            error: (error as Error).message,
        });
    }
}

export async function forceLogoutIdleSessions(req: Request, res: Response) {
    try {
        const idleMinutes = Math.max(1, parseInt(String(req.body?.idleMinutes || "15"), 10) || 15);
        const allSessions = await fetchEnrichedActiveSessions(
            req.sessionID,
            idleMinutes * 60,
        );

        const idleTargets = allSessions.filter(
            (s) => s.status === "idle" && !s.isCurrentSession,
        );

        if (idleTargets.length === 0) {
            return res.status(200).json({
                terminatedCount: 0,
                message: "No idle sessions found matching threshold",
            });
        }

        const sids = idleTargets.map((s) => s.sid);
        await db.delete(sessions).where(inArray(sessions.sid, sids));

        logAction(req, {
            action: "logout",
            table: "sessions",
            data: {
                idleMinutes,
                terminatedCount: idleTargets.length,
                terminatedUsers: idleTargets.map((s) => s.username),
                forcedBy: req.user?.id,
            },
            userId: req.user?.id,
            msg: `SysAdmin force-logged out ${idleTargets.length} idle session(s) (>= ${idleMinutes}m)`,
        });

        return res.status(200).json({
            terminatedCount: idleTargets.length,
            message: `Terminated ${idleTargets.length} idle session(s)`,
        });
    } catch (error) {
        console.error("Failed to force logout idle sessions:", error);
        return res.status(500).json({
            message: "Failed to force logout idle sessions",
            error: (error as Error).message,
        });
    }
}
