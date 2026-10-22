import { Request, Response } from "express";
import { db } from "@/db";
import {
    incomes,
    incomeLines,
    journals,
    journalEntries,
    glAccounts,
    branches,
} from "@/db/schemas";
import { and, desc, eq, gte, like, lte, or, sql } from "drizzle-orm";
import { branchScope, resolveBranchCode, resolveBranchId, resolveBranchCodeFromId } from "@/helpers/branch.helper";
import { generateIncomeCode, generateJournalInvoice } from "@/helpers/generate-invoice";
import { parseTableQuery } from "@/services/table-query";
import { logAction } from "@/utils/log-helper";
import { z } from "zod";

const incomeInsertSchema = z.object({
    date: z.string().min(1, "Date is required"),
    depositAccountId: z.string().min(1, "Deposit account (Cash/Bank) is required"),
    branchId: z.string().optional().nullable(),
    reference: z.string().optional().nullable(),
    description: z.string().min(1, "Description is required"),
    lines: z.array(
        z.object({
            glAccountId: z.string().min(1, "Income category / account is required"),
            amount: z.number().positive("Amount must be greater than 0"),
            note: z.string().optional().nullable(),
        })
    ).min(1, "At least one income item is required"),
});

export const getPaginatedIncomes = async (req: Request, res: Response) => {
    try {
        const {
            search,
            pageIndex,
            pageSize,
            offset,
            from,
            to,
            select,
        } = parseTableQuery(req.query);

        const scope = branchScope(incomes.branchId, req);

        const searchCondition = search
            ? or(
                  like(sql`LOWER(${incomes.code})`, `%${search.toLowerCase()}%`),
                  like(sql`LOWER(${incomes.description})`, `%${search.toLowerCase()}%`),
                  like(sql`LOWER(${incomes.reference})`, `%${search.toLowerCase()}%`)
              )
            : undefined;

        const dateCondition =
            from && to
                ? and(
                      gte(incomes.date, from.toISOString().slice(0, 10)),
                      lte(incomes.date, to.toISOString().slice(0, 10))
                  )
                : from
                ? gte(incomes.date, from.toISOString().slice(0, 10))
                : to
                ? lte(incomes.date, to.toISOString().slice(0, 10))
                : undefined;

        const statusCondition = select ? eq(incomes.status, select as any) : undefined;

        const conditions = and(scope, searchCondition, dateCondition, statusCondition);

        const [list, [totalCount]] = await Promise.all([
            db
                .select({
                    id: incomes.id,
                    code: incomes.code,
                    date: incomes.date,
                    totalAmount: incomes.totalAmount,
                    reference: incomes.reference,
                    description: incomes.description,
                    status: incomes.status,
                    createdAt: incomes.createdAt,
                    depositAccountName: glAccounts.name,
                    depositAccountCode: glAccounts.code,
                    branchName: branches.name,
                })
                .from(incomes)
                .innerJoin(glAccounts, eq(incomes.depositAccountId, glAccounts.id))
                .innerJoin(branches, eq(incomes.branchId, branches.id))
                .where(conditions)
                .orderBy(desc(incomes.createdAt))
                .limit(pageSize)
                .offset(offset),
            db
                .select({ count: sql<number>`count(*)` })
                .from(incomes)
                .where(conditions),
        ]);

        res.json({
            rows: list,
            pageCount: Math.ceil(Number(totalCount?.count || 0) / pageSize),
            rowCount: Number(totalCount?.count || 0),
            pageIndex,
            pageSize,
        });
    } catch (error) {
        console.error("Error fetching incomes:", error);
        res.status(500).json({ message: "Failed to fetch incomes" });
    }
};

export const getIncomeById = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const [income] = await db
            .select({
                id: incomes.id,
                code: incomes.code,
                date: incomes.date,
                depositAccountId: incomes.depositAccountId,
                branchId: incomes.branchId,
                userId: incomes.userId,
                totalAmount: incomes.totalAmount,
                reference: incomes.reference,
                description: incomes.description,
                status: incomes.status,
                journalId: incomes.journalId,
                createdAt: incomes.createdAt,
                depositAccountName: glAccounts.name,
                depositAccountCode: glAccounts.code,
                branchName: branches.name,
            })
            .from(incomes)
            .innerJoin(glAccounts, eq(incomes.depositAccountId, glAccounts.id))
            .innerJoin(branches, eq(incomes.branchId, branches.id))
            .where(eq(incomes.id, id));

        if (!income) {
            return res.status(404).json({ message: "Income not found" });
        }

        const lines = await db
            .select({
                id: incomeLines.id,
                glAccountId: incomeLines.glAccountId,
                glAccountName: glAccounts.name,
                glAccountCode: glAccounts.code,
                amount: incomeLines.amount,
                note: incomeLines.note,
            })
            .from(incomeLines)
            .innerJoin(glAccounts, eq(incomeLines.glAccountId, glAccounts.id))
            .where(eq(incomeLines.incomeId, id));

        res.json({ ...income, lines });
    } catch (error) {
        console.error("Error fetching income:", error);
        res.status(500).json({ message: "Failed to fetch income" });
    }
};

export const createIncome = async (req: Request, res: Response) => {
    const parsed = incomeInsertSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    const data = parsed.data;

    try {
        const branchCode = await resolveBranchCode(req);
        const resolvedBranchId = await resolveBranchId(data.branchId, req);

        const totalAmount = data.lines.reduce(
            (sum, line) => sum + Number(line.amount),
            0
        );

        const code = await generateIncomeCode(branchCode);

        const result = await db.transaction(async (tx) => {
            // 1. Insert Income as draft
            const [income] = await tx
                .insert(incomes)
                .values({
                    code,
                    date: data.date,
                    depositAccountId: data.depositAccountId,
                    branchId: resolvedBranchId,
                    userId: req.user!.id,
                    totalAmount,
                    reference: data.reference,
                    description: data.description,
                    status: "draft",
                })
                .returning();

            // 2. Insert Income Lines
            for (const line of data.lines) {
                await tx.insert(incomeLines).values({
                    incomeId: income.id,
                    glAccountId: line.glAccountId,
                    amount: Number(line.amount),
                    note: line.note,
                });
            }

            return income;
        });

        logAction(req, {
            action: "insert",
            table: "incomes",
            data: result,
            userId: req.user!.id,
            msg: `created income draft ${result.code}`,
        });

        res.status(201).json({
            message: "Income saved as draft",
            income: result,
        });
    } catch (error: any) {
        console.error("Create income error:", error);
        res.status(500).json({
            message: error.message || "Failed to record income",
        });
    }
};

export const updateIncome = async (req: Request, res: Response) => {
    const { id } = req.params;
    const parsed = incomeInsertSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    const data = parsed.data;

    try {
        const [existing] = await db
            .select()
            .from(incomes)
            .where(eq(incomes.id, id))
            .limit(1);

        if (!existing) return res.status(404).json({ message: "Income not found" });
        if (existing.status !== "draft") {
            return res.status(400).json({ message: "Only draft incomes can be edited" });
        }

        const totalAmount = data.lines.reduce((sum, line) => sum + Number(line.amount), 0);

        await db.transaction(async (tx) => {
            await tx
                .update(incomes)
                .set({
                    date: data.date,
                    depositAccountId: data.depositAccountId,
                    totalAmount,
                    reference: data.reference,
                    description: data.description,
                    updatedAt: new Date(),
                })
                .where(eq(incomes.id, id));

            await tx.delete(incomeLines).where(eq(incomeLines.incomeId, id));

            for (const line of data.lines) {
                await tx.insert(incomeLines).values({
                    incomeId: id,
                    glAccountId: line.glAccountId,
                    amount: Number(line.amount),
                    note: line.note,
                });
            }
        });

        logAction(req, {
            action: "update",
            table: "incomes",
            data: { id },
            userId: req.user!.id,
            msg: `updated income draft ${existing.code}`,
        });

        res.json({ message: "Income updated successfully", income: { ...existing, totalAmount } });
    } catch (error: any) {
        console.error("Update income error:", error);
        res.status(500).json({ message: error.message || "Failed to update income" });
    }
};

export const postIncome = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        const [existing] = await db
            .select()
            .from(incomes)
            .where(eq(incomes.id, id))
            .limit(1);

        if (!existing) return res.status(404).json({ message: "Income not found" });
        if (existing.status !== "draft") {
            return res.status(400).json({ message: "Only draft incomes can be posted" });
        }

        const lines = await db
            .select()
            .from(incomeLines)
            .where(eq(incomeLines.incomeId, id));

        const totalAmount = lines.reduce((sum, l) => sum + Number(l.amount), 0);

        const branchCode = await resolveBranchCodeFromId(existing.branchId);

        await db.transaction(async (tx) => {
            // 1. Create posted Journal
            const [journal] = await tx
                .insert(journals)
                .values({
                    invoice: existing.code,
                    branchId: existing.branchId,
                    date: existing.date,
                    description: `Penerimaan #${existing.code}: ${existing.description}`,
                    status: "posted",
                })
                .returning();

            // 2. Debit Cash/Bank (Deposit Account)
            await tx.insert(journalEntries).values({
                journalId: journal.id,
                glAccountId: existing.depositAccountId,
                debit: totalAmount,
                credit: 0,
                note: `Penerimaan Kas/Bank #${existing.code}`,
            });

            // 3. Credit each income line
            for (const line of lines) {
                await tx.insert(journalEntries).values({
                    journalId: journal.id,
                    glAccountId: line.glAccountId,
                    debit: 0,
                    credit: Number(line.amount),
                    note: line.note || existing.description,
                });
            }

            // 4. Mark income as posted
            await tx
                .update(incomes)
                .set({ status: "posted", journalId: journal.id, updatedAt: new Date() })
                .where(eq(incomes.id, id));
        });

        logAction(req, {
            action: "update",
            table: "incomes",
            data: { id, status: "posted" },
            userId: req.user!.id,
            msg: `posted income ${existing.code}`,
        });

        res.json({ message: "Income posted successfully" });
    } catch (error: any) {
        console.error("Post income error:", error);
        res.status(error.statusCode || 500).json({ message: error.message || "Failed to post income" });
    }
};

export const cancelIncome = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        await db.transaction(async (tx) => {
            const [income] = await tx
                .select()
                .from(incomes)
                .where(eq(incomes.id, id));

            if (!income) throw new Error("Income not found");
            if (income.status === "cancelled") {
                throw new Error("Income is already cancelled");
            }

            const lines = await tx
                .select()
                .from(incomeLines)
                .where(eq(incomeLines.incomeId, id));

            // Create Reversal Journal if original had a posted journal
            if (income.journalId) {
                const branchCode = await resolveBranchCodeFromId(income.branchId);
                const reversalInvoice = await generateJournalInvoice("income", branchCode);
                const [reversalJournal] = await tx
                    .insert(journals)
                    .values({
                        invoice: reversalInvoice,
                        branchId: income.branchId,
                        date: new Date().toISOString().slice(0, 10),
                        description: `Void Penerimaan #${income.code}: ${income.description}`,
                        status: "posted",
                    })
                    .returning();

                // Reverse income lines: Debit Pendapatan
                for (const line of lines) {
                    await tx.insert(journalEntries).values({
                        journalId: reversalJournal.id,
                        glAccountId: line.glAccountId,
                        debit: Number(line.amount),
                        credit: 0,
                        note: `Void Penerimaan #${income.code}`,
                    });
                }

                // Reverse Cash/Bank: Credit Kas/Bank
                await tx.insert(journalEntries).values({
                    journalId: reversalJournal.id,
                    glAccountId: income.depositAccountId,
                    debit: 0,
                    credit: Number(income.totalAmount),
                    note: `Void Penerimaan Kas/Bank #${income.code}`,
                });
            }

            // Update Income status
            await tx
                .update(incomes)
                .set({ status: "cancelled", updatedAt: new Date() })
                .where(eq(incomes.id, id));

            logAction(req, {
                action: "update",
                table: "incomes",
                data: income,
                userId: req.user!.id,
                msg: `cancelled income ${income.code}`,
            });
        });

        res.json({ message: "Income cancelled successfully" });
    } catch (error: any) {
        console.error("Cancel income error:", error);
        res.status(500).json({ message: error.message || "Failed to cancel income" });
    }
};
