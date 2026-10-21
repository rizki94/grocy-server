import { Request, Response } from "express";
import { db } from "@/db";
import {
    expenses,
    expenseLines,
    journals,
    journalEntries,
    glAccounts,
    branches,
} from "@/db/schemas";
import { and, desc, eq, gte, like, lte, or, sql } from "drizzle-orm";
import { branchScope, resolveBranchCode, resolveBranchId } from "@/helpers/branch.helper";
import { generateExpenseCode } from "@/helpers/generate-invoice";
import { parseTableQuery } from "@/services/table-query";
import { logAction } from "@/utils/log-helper";
import { z } from "zod";

const expenseInsertSchema = z.object({
    date: z.string().min(1, "Date is required"),
    paymentAccountId: z.string().min(1, "Payment account (Cash/Bank) is required"),
    branchId: z.string().optional().nullable(),
    reference: z.string().optional().nullable(),
    description: z.string().min(1, "Description is required"),
    lines: z.array(
        z.object({
            glAccountId: z.string().min(1, "Expense category is required"),
            amount: z.number().positive("Amount must be greater than 0"),
            note: z.string().optional().nullable(),
        })
    ).min(1, "At least one expense item is required"),
});

export const getPaginatedExpenses = async (req: Request, res: Response) => {
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

        const scope = branchScope(expenses.branchId, req);

        const searchCondition = search
            ? or(
                  like(sql`LOWER(${expenses.code})`, `%${search.toLowerCase()}%`),
                  like(sql`LOWER(${expenses.description})`, `%${search.toLowerCase()}%`),
                  like(sql`LOWER(${expenses.reference})`, `%${search.toLowerCase()}%`)
              )
            : undefined;

        const dateCondition =
            from && to
                ? and(
                      gte(expenses.date, from.toISOString().slice(0, 10)),
                      lte(expenses.date, to.toISOString().slice(0, 10))
                  )
                : from
                ? gte(expenses.date, from.toISOString().slice(0, 10))
                : to
                ? lte(expenses.date, to.toISOString().slice(0, 10))
                : undefined;

        const statusCondition = select ? eq(expenses.status, select as any) : undefined;

        const conditions = and(scope, searchCondition, dateCondition, statusCondition);

        const [list, [totalCount]] = await Promise.all([
            db
                .select({
                    id: expenses.id,
                    code: expenses.code,
                    date: expenses.date,
                    totalAmount: expenses.totalAmount,
                    reference: expenses.reference,
                    description: expenses.description,
                    status: expenses.status,
                    createdAt: expenses.createdAt,
                    paymentAccountName: glAccounts.name,
                    paymentAccountCode: glAccounts.code,
                    branchName: branches.name,
                })
                .from(expenses)
                .innerJoin(glAccounts, eq(expenses.paymentAccountId, glAccounts.id))
                .innerJoin(branches, eq(expenses.branchId, branches.id))
                .where(conditions)
                .orderBy(desc(expenses.createdAt))
                .limit(pageSize)
                .offset(offset),
            db
                .select({ count: sql<number>`count(*)` })
                .from(expenses)
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
        console.error("Error fetching expenses:", error);
        res.status(500).json({ message: "Failed to fetch expenses" });
    }
};

export const getExpenseById = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const [expense] = await db
            .select({
                id: expenses.id,
                code: expenses.code,
                date: expenses.date,
                paymentAccountId: expenses.paymentAccountId,
                branchId: expenses.branchId,
                userId: expenses.userId,
                totalAmount: expenses.totalAmount,
                reference: expenses.reference,
                description: expenses.description,
                status: expenses.status,
                journalId: expenses.journalId,
                createdAt: expenses.createdAt,
                paymentAccountName: glAccounts.name,
                paymentAccountCode: glAccounts.code,
                branchName: branches.name,
            })
            .from(expenses)
            .innerJoin(glAccounts, eq(expenses.paymentAccountId, glAccounts.id))
            .innerJoin(branches, eq(expenses.branchId, branches.id))
            .where(eq(expenses.id, id));

        if (!expense) {
            return res.status(404).json({ message: "Expense not found" });
        }

        const lines = await db
            .select({
                id: expenseLines.id,
                glAccountId: expenseLines.glAccountId,
                glAccountName: glAccounts.name,
                glAccountCode: glAccounts.code,
                amount: expenseLines.amount,
                note: expenseLines.note,
            })
            .from(expenseLines)
            .innerJoin(glAccounts, eq(expenseLines.glAccountId, glAccounts.id))
            .where(eq(expenseLines.expenseId, id));

        res.json({
            ...expense,
            lines,
        });
    } catch (error) {
        console.error("Error fetching expense:", error);
        res.status(500).json({ message: "Failed to fetch expense" });
    }
};

export const createExpense = async (req: Request, res: Response) => {
    const parsed = expenseInsertSchema.safeParse(req.body);
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
        const code = await generateExpenseCode(branchCode);

        const totalAmount = data.lines.reduce((sum, line) => sum + Number(line.amount), 0);

        const result = await db.transaction(async (tx) => {
            // 1. Create Journal
            const [journal] = await tx
                .insert(journals)
                .values({
                    branchId: resolvedBranchId,
                    date: data.date,
                    description: `Biaya #${code}: ${data.description}`,
                    status: "posted",
                })
                .returning();

            // 2. Insert Debit Journal Entries for each expense line
            for (const line of data.lines) {
                await tx.insert(journalEntries).values({
                    journalId: journal.id,
                    glAccountId: line.glAccountId,
                    debit: Number(line.amount),
                    credit: 0,
                    note: line.note || data.description,
                });
            }

            // 3. Insert Balancing Credit Journal Entry for Cash/Bank
            await tx.insert(journalEntries).values({
                journalId: journal.id,
                glAccountId: data.paymentAccountId,
                debit: 0,
                credit: totalAmount,
                note: `Pengeluaran Kas/Bank #${code}`,
            });

            // 4. Create Expense Record
            const [expense] = await tx
                .insert(expenses)
                .values({
                    code,
                    date: data.date,
                    paymentAccountId: data.paymentAccountId,
                    branchId: resolvedBranchId,
                    userId: req.user!.id,
                    totalAmount,
                    reference: data.reference,
                    description: data.description,
                    status: "posted",
                    journalId: journal.id,
                })
                .returning();

            // 5. Insert Expense Lines
            for (const line of data.lines) {
                await tx.insert(expenseLines).values({
                    expenseId: expense.id,
                    glAccountId: line.glAccountId,
                    amount: Number(line.amount),
                    note: line.note,
                });
            }

            return expense;
        });

        logAction(req, {
            action: "insert",
            table: "expenses",
            data: result,
            userId: req.user!.id,
            msg: `created expense #${result.code}`,
        });

        res.status(201).json({
            message: "Expense recorded successfully",
            expense: result,
        });
    } catch (error: any) {
        console.error("Create expense error:", error);
        res.status(500).json({
            message: error.message || "Failed to record expense",
        });
    }
};

export const cancelExpense = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        await db.transaction(async (tx) => {
            const [expense] = await tx
                .select()
                .from(expenses)
                .where(eq(expenses.id, id));

            if (!expense) throw new Error("Expense not found");
            if (expense.status === "cancelled") {
                throw new Error("Expense is already cancelled");
            }

            const lines = await tx
                .select()
                .from(expenseLines)
                .where(eq(expenseLines.expenseId, id));

            // Create Reversal Journal if original had a posted journal
            if (expense.journalId) {
                const [reversalJournal] = await tx
                    .insert(journals)
                    .values({
                        branchId: expense.branchId,
                        date: new Date().toISOString().slice(0, 10),
                        description: `Void Biaya #${expense.code}: ${expense.description}`,
                        status: "posted",
                    })
                    .returning();

                // Reverse expense lines: Credit Beban
                for (const line of lines) {
                    await tx.insert(journalEntries).values({
                        journalId: reversalJournal.id,
                        glAccountId: line.glAccountId,
                        debit: 0,
                        credit: Number(line.amount),
                        note: `Void Biaya #${expense.code}`,
                    });
                }

                // Reverse cash: Debit Kas/Bank (restore cash)
                await tx.insert(journalEntries).values({
                    journalId: reversalJournal.id,
                    glAccountId: expense.paymentAccountId,
                    debit: Number(expense.totalAmount),
                    credit: 0,
                    note: `Void Pengeluaran Kas/Bank #${expense.code}`,
                });

                // Mark original journal as cancelled
                await tx
                    .update(journals)
                    .set({ status: "cancelled", updatedAt: new Date() })
                    .where(eq(journals.id, expense.journalId));
            }

            // Mark expense as cancelled
            await tx
                .update(expenses)
                .set({ status: "cancelled", updatedAt: new Date() })
                .where(eq(expenses.id, id));

            logAction(req, {
                action: "update",
                table: "expenses",
                data: expense,
                userId: req.user!.id,
                msg: `voided expense #${expense.code}`,
            });
        });

        res.json({ message: "Expense cancelled successfully" });
    } catch (error: any) {
        console.error("Cancel expense error:", error);
        res.status(500).json({
            message: error.message || "Failed to cancel expense",
        });
    }
};
