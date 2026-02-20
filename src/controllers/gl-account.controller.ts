import { Request, Response } from "express";
import { db } from "@/db";
import { glAccounts } from "@/db/schemas";
import {
    glAccountInsertSchema,
    glAccountUpdateSchema,
    GlAccountUpdateInput,
} from "@/validators/gl-account.validator";
import { and, asc, desc, eq, like, or, sql } from "drizzle-orm";
import { PgColumn } from "drizzle-orm/pg-core";
import { logAction } from "@/utils/log-helper";
import { findLeafGlAccounts } from "@/repositories/gl-account.repository";

export const getAllGlAccounts = async (req: Request, res: Response) => {
    try {
        const accounts = await db
            .select()
            .from(glAccounts)
            .orderBy(asc(sql`${glAccounts.code}::integer`));
        res.json(accounts);
    } catch (err: any) {
        console.error("getGlAccounts error:", err);
        res.status(500).json({ message: err.message });
    }
};

export const getActiveGlAccounts = async (req: Request, res: Response) => {
    try {
        const accounts = await db
            .select()
            .from(glAccounts)
            .where(eq(glAccounts.isActive, true))
            .orderBy(sql`CAST(${glAccounts.code} AS integer)`);
        res.json(accounts);
    } catch (err: any) {
        console.error("getGlAccounts error:", err);
        res.status(500).json({ message: err.message });
    }
};

export const getGlAccountById = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const [account] = await db
            .select()
            .from(glAccounts)
            .where(eq(glAccounts.id, id));

        if (!account)
            return res.status(404).json({ message: "Account not found" });

        res.json(account);
    } catch (err: any) {
        console.error("getGlAccountById error:", err);
        res.status(500).json({ message: err.message });
    }
};

export const getLeafGlAccounts = async (req: Request, res: Response) => {
    try {
        const accounts = await findLeafGlAccounts();
        res.json(accounts);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch leaf accounts" });
    }
};

export const createGlAccount = async (req: Request, res: Response) => {
    const parsed = glAccountInsertSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    try {
        const existingName = await db
            .select()
            .from(glAccounts)
            .where(eq(glAccounts.name, parsed.data.name))
            .then((res) => res[0]);

        if (existingName) {
            return res
                .status(409)
                .json({ message: "Price Group already exists" });
        }

        const [createdGlAccount] = await db
            .insert(glAccounts)
            .values({
                ...parsed.data,
            })
            .returning();

        logAction(req, {
            action: "insert",
            table: "gl_accounts",
            data: createdGlAccount,
            userId: req.user!.id,
            msg: `created gl account #${createdGlAccount.id}`,
        });

        return res.status(201).json({
            message: "GlAccount created successfully",
            createdGlAccount,
        });
    } catch (error) {
        console.error("error creating gl account:", error);
        return res.status(500).json({ message: "Failed to create gl account" });
    }
};

export const updateGlAccount = async (req: Request, res: Response) => {
    try {
        const payload: GlAccountUpdateInput = glAccountUpdateSchema.parse(
            req.body,
        );

        const oldGlAccount = await db
            .select()
            .from(glAccounts)
            .where(eq(glAccounts.id, payload.id))
            .then((r) => r[0]);

        const [updated] = await db
            .update(glAccounts)
            .set({
                name: payload.name,
                code: payload.code,
                type: payload.type,
                parentId: payload.parentId ?? null,
                isActive: payload.isActive,
            })
            .where(eq(glAccounts.id, payload.id))
            .returning();

        if (!updated)
            return res.status(404).json({ message: "Account not found" });

        logAction(req, {
            action: "update",
            table: "gl_accounts",
            oldData: oldGlAccount,
            data: updated,
            userId: req.user!.id,
            msg: `updated gl account #${updated.id}`,
        });

        res.json({ message: "GL account updated", account: updated });
    } catch (err: any) {
        console.error("updateGlAccount error:", err);
        res.status(400).json({
            message: err.message,
            errors: err.errors ?? null,
        });
    }
};

export const getPaginatedGlAccounts = async (req: Request, res: Response) => {
    try {
        const query = req.query;

        const pageIndex = parseInt(query.pageIndex as string) || 0;
        const pageSize = parseInt(query.pageSize as string) || 10;
        const offset = pageIndex * pageSize;

        const search = (query.search as string) ?? "";
        const searchCondition = search
            ? or(
                like(
                    sql`LOWER(${glAccounts.name})`,
                    `%${search.toLowerCase()}%`,
                ),
            )
            : undefined;

        // mapping sort
        const sortColumns: Record<string, PgColumn | any> = {
            name: glAccounts.name,
            code: sql`(${glAccounts.code})::integer`, // cast string -> int
        };

        const sortKey = (query.sort as string) ?? "code"; // default sort by code
        const order = (query.order as string) === "desc" ? "desc" : "asc";
        const sortColumn = sortColumns[sortKey] ?? sortColumns.code;

        const [glAccountList, totalCount] = await Promise.all([
            db
                .select()
                .from(glAccounts)
                .where(searchCondition)
                .orderBy(order === "desc" ? desc(sortColumn) : asc(sortColumn))
                .limit(pageSize)
                .offset(offset),
            db
                .select({ count: sql<number>`count(*)` })
                .from(glAccounts)
                .where(searchCondition),
        ]);

        res.json({
            rows: glAccountList,
            pageCount: Math.ceil(Number(totalCount[0]?.count || 0) / pageSize),
            rowCount: Number(totalCount[0]?.count || 0),
            pageIndex,
            pageSize,
            sort: sortKey,
            order,
        });
    } catch (error) {
        console.error("Error fetching gl accounts:", error);
        res.status(500).json({ message: "Failed to fetch gl accounts" });
    }
};
