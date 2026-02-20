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

        // Filter by table
        if (tableFilter) {
            lines = lines.filter((log) => log.table === tableFilter);
        }

        // Filter by search
        if (search) {
            lines = lines.filter((log) => {
                const msg = (log.msg || "").toLowerCase();
                const table = (log.table || "").toLowerCase();
                const action = (log.action || "").toLowerCase();
                const username = (log.userId ? usersMap[log.userId] || "unknown" : "unknown").toLowerCase();

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
            performedByUsername: log.userId
                ? usersMap[log.userId] || "unknown"
                : null,
        }));

        res.json({
            rows,
            pageCount: Math.ceil(totalCount / pageSize),
            rowCount: totalCount,
            pageIndex,
            pageSize,
        });
    } catch (err: any) {
        console.error("LOGS ERROR DETAILS:", err);
        res.status(500).json({
            error: "cannot read logs",
            details: err.message,
        });
    }
};
