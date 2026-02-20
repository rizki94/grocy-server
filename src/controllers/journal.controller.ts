import { db } from "@/db";
import { journals } from "@/db/schemas";
import { logAction } from "@/utils/log-helper";
import {
    createJournal,
    findAllJournals,
    findJournalById,
    updateJournal,
} from "@/repositories/journal.repository";
import {
    journalWithEntriesInsertSchema,
    journalWithEntriesUpdateSchema,
} from "@/validators/journal.vaildator";
import { and, asc, desc, eq, gte, like, lte, or, sql } from "drizzle-orm";
import { PgColumn } from "drizzle-orm/pg-core";
import { Request, Response } from "express";

export const getAllJournals = async (req: Request, res: Response) => {
    try {
        const data = await findAllJournals();
        return res.status(200).json(data);
    } catch {
        return res.status(500).json({ message: "Failed to fetch journals" });
    }
};

export const getJournalById = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const rows = await findJournalById(id);

        if (rows.length === 0) {
            return res.status(404).json({ error: "Journal not found" });
        }

        const { journal } = rows[0];
        const entries = rows.filter((r) => r.entries).map((r) => r.entries!);

        res.status(200).json({ ...journal, entries });
    } catch (error) {
        console.error("Error fetching journal:", error);
        res.status(500).json({ message: "Failed to fetch journal" });
    }
};

export const createJournalController = async (req: Request, res: Response) => {
    const parsed = journalWithEntriesInsertSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    const data = parsed.data;

    try {
        const createdJournal = await createJournal(data, req.user!);
        logAction(req, {
            action: "insert",
            table: "journals",
            data: createdJournal,
            userId: req.user!.id,
            msg: `created journal #${createdJournal.id}`,
        });

        return res.json({
            message: "Journal created successfully",
            createdJournal,
        });
    } catch {
        return res.status(500).json({ message: "Failed to create journal" });
    }
};

export const updateJournalController = async (req: Request, res: Response) => {
    const parsed = journalWithEntriesUpdateSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    const data = parsed.data;
    try {
        const [oldJournal] = await db
            .select()
            .from(journals)
            .where(eq(journals.id, data.id))
            .limit(1);

        if (!oldJournal)
            return res.status(404).json({ message: "Journal not found" });

        if (oldJournal.status !== "draft") {
            return res
                .status(400)
                .json({ message: "Only draft journals can be edited" });
        }

        const updatedJournal = await updateJournal(data);
        logAction(req, {
            action: "update",
            table: "journals",
            oldData: oldJournal,
            data: updatedJournal,
            userId: req.user!.id,
            msg: `updated journal #${data.id}`,
        });

        return res.json({
            message: "Payment updated successfully",
            updatedJournal,
        });
    } catch {
        return res.status(500).json({ message: "Failed to update journal" });
    }
};

export const postJournal = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const [postedJournal] = await db
            .update(journals)
            .set({ status: "posted" })
            .where(eq(journals.id, id))
            .returning();

        logAction(req, {
            action: "update",
            table: "journals",
            data: postedJournal,
            userId: req.user!.id,
            msg: `posted journal #${id}`,
        });

        return res.status(200).json(postedJournal);
    } catch {
        return res.status(500).json({ message: "Failed to post journal" });
    }
};

export const getPaginatedJournals = async (req: Request, res: Response) => {
    try {
        const { pageIndex, pageSize, search, sort, order, from, to } =
            req.query;

        const page = parseInt(pageIndex as string) || 0;
        const limit = parseInt(pageSize as string) || 5;
        const offset = page * limit;

        const searchCondition = search
            ? or(
                like(
                    sql`LOWER(${journals.description})`,
                    `%${(search as string).toLowerCase()}%`,
                ),
            )
            : undefined;

        const status = req.query.select as string;
        const statusCondition = status
            ? eq(journals.status, status as any)
            : undefined;

        const fromDate = from ? new Date(from as string) : undefined;
        const toDate = to ? new Date(to as string) : undefined;

        const dateCondition =
            fromDate && toDate
                ? and(
                    gte(journals.date, fromDate.toISOString()),
                    lte(journals.date, toDate.toISOString()),
                )
                : fromDate
                    ? gte(journals.date, fromDate.toISOString())
                    : toDate
                        ? lte(journals.date, toDate.toISOString())
                        : undefined;

        const sortColumns: Record<string, any> = {
            description: journals.description,
            date: journals.date,
        };

        const sortKey = sortColumns[sort as string] ?? journals.description;
        const sortOrder = order === "desc" ? desc(sortKey) : asc(sortKey);

        const [journalList, totalCount] = await Promise.all([
            db
                .select()
                .from(journals)
                .where(and(searchCondition, dateCondition, statusCondition))
                .orderBy(sortOrder)
                .limit(limit)
                .offset(offset),

            db
                .select({ count: sql<number>`count(*)` })
                .from(journals)
                .where(and(searchCondition, dateCondition, statusCondition)),
        ]);

        const total = Number(totalCount[0]?.count || 0);

        res.json({
            rows: journalList,
            pageCount: Math.ceil(total / limit),
            rowCount: total,
            pageIndex: page,
            pageSize: limit,
            sort: sort || "description",
            order: order || "asc",
        });
    } catch (error) {
        console.error("Error fetching journals:", error);
        res.status(500).json({ message: "Failed to fetch journals" });
    }
};
