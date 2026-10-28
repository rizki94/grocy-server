import fs from "fs/promises";
import { db } from "@/db";
import { inArray } from "drizzle-orm";
import { users } from "@/db/schemas";
import { Request, Response } from "express";

export const getLogs = async (req: Request, res: Response) => {
    try {
        const query = req.query;
        const pageIndex = parseInt(query.pageIndex as string) || 0;
        const pageSize = parseInt(query.pageSize as string) || 10;
        const search = (query.search as string)?.toLowerCase() || "";
        const tableFilter = (query.table as string) || "";
        const actionFilter = (query.action as string)?.toLowerCase() || "";
        const userFilter = (query.userId as string) || "";
        const levelFilter = (query.level as string)?.toLowerCase() || "";
        const parseDateBound = (value: unknown, endOfDay: boolean) => {
            if (typeof value !== "string" || !value) return undefined;
            const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
            const normalized = dateOnly
                ? `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`
                : value;
            const timestamp = new Date(normalized).getTime();
            return Number.isFinite(timestamp) ? timestamp : undefined;
        };
        const from = parseDateBound(query.from, false);
        const to = parseDateBound(query.to, true);
        const sortOrder = (query.order as string) === "asc" ? "asc" : "desc";

        const data = await fs.readFile("./logs/log.json", "utf-8");

        let lines = data
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
                try {
                    return JSON.parse(line);
                } catch (e) {
                    return null;
                }
            })
            .filter(Boolean);

        // Pre-fetch all users for enrichment and search
        const userList = await db
            .select({ id: users.id, username: users.username })
            .from(users);
        const usersMap = Object.fromEntries(
            userList.map((u) => [u.id, u.username])
        );

        const getLevelName = (level: number) => {
            if (!Number.isFinite(level)) return "";
            const names: Record<number, string> = {
                10: "trace",
                20: "debug",
                30: "info",
                40: "warn",
                50: "error",
                60: "fatal",
            };
            return names[level] || String(level);
        };
        const getActionName = (log: any) =>
            String(log.action || log.req?.method || "").toLowerCase();
        const getUserId = (log: any) =>
            String(log.performedBy || log.userId || log.req?.user?.id || "");

        const filters = {
            actions: Array.from(
                new Set(lines.map(getActionName).filter(Boolean)),
            ).sort(),
            tables: Array.from(
                new Set(lines.map((log) => String(log.table || "")).filter(Boolean)),
            ).sort(),
            users: Array.from(
                new Set(
                    lines
                        .map(getUserId)
                        .filter(Boolean),
                ),
            )
                .map((id) => ({ id, name: usersMap[id] || id }))
                .sort((a, b) => a.name.localeCompare(b.name)),
            levels: Array.from(
                new Set(lines.map((log) => getLevelName(Number(log.level))).filter(Boolean)),
            ).sort(),
        };

        // Filter by table
        if (tableFilter) {
            lines = lines.filter((log) => log.table === tableFilter);
        }

        if (actionFilter) {
            lines = lines.filter((log) => getActionName(log) === actionFilter);
        }

        if (userFilter) {
            lines = lines.filter((log) => {
                const userId = getUserId(log);
                return userFilter === "system" ? !userId : userId === userFilter;
            });
        }

        if (levelFilter) {
            lines = lines.filter(
                (log) => getLevelName(Number(log.level)) === levelFilter,
            );
        }

        if (from !== undefined) {
            lines = lines.filter((log) => Number(log.time) >= from);
        }

        if (to !== undefined) {
            lines = lines.filter((log) => Number(log.time) <= to);
        }

        // Filter by search
        if (search) {
            lines = lines.filter((log) => {
                const msg = (log.msg || "").toLowerCase();
                const table = (log.table || "").toLowerCase();
                const action = getActionName(log);
                const userId = getUserId(log);
                const username = (userId ? usersMap[userId] || userId : "unknown").toLowerCase();

                return (
                    msg.includes(search) ||
                    table.includes(search) ||
                    action.includes(search) ||
                    username.includes(search)
                );
            });
        }

        // Sort by time (default newest first)
        lines.sort((a, b) => {
            const timeA = new Date(a.time).getTime();
            const timeB = new Date(b.time).getTime();
            return sortOrder === "desc" ? timeB - timeA : timeA - timeB;
        });

        const totalCount = lines.length;
        const start = pageIndex * pageSize;
        const paginatedLines = lines.slice(start, start + pageSize);

        const rows = paginatedLines.map((log) => ({
            ...log,
            performedByUsername: getUserId(log)
                ? usersMap[getUserId(log)] || getUserId(log) || "unknown"
                : null,
        }));

        res.json({
            rows,
            pageCount: Math.ceil(totalCount / pageSize),
            rowCount: totalCount,
            pageIndex,
            pageSize,
            filters,
        });
    } catch (err: any) {
        console.error("LOGS ERROR DETAILS:", err);
        res.status(500).json({
            error: "cannot read logs",
            details: err.message,
        });
    }
};
