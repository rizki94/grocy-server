import { db } from "@/db";
import {
    bankReconciliations,
    bankReconciliationItems,
    glAccounts,
    journals,
    journalEntries,
    branches,
    users,
} from "@/db/schemas";
import {
    eq,
    and,
    inArray,
    notInArray,
    sql,
    desc,
    ilike,
    gte,
    lte,
    asc,
    isNotNull,
} from "drizzle-orm";
import type { Request, Response } from "express";
import { z } from "zod";
import {
    resolveBranchId,
    resolveBranchCodeFromId,
    branchScope,
} from "@/helpers/branch.helper";
import { logAction } from "@/utils/log-helper";

/* ─────────────────── validation ─────────────────── */

const createBankReconciliationSchema = z.object({
    name: z.string().min(1),
    bankAccountId: z.string().uuid(),
    reconciliationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
    statementBalance: z.number().default(0),
    openingBalance: z.number().optional(),
    note: z.string().optional().nullable(),
});

const updateClearedItemsSchema = z.object({
    items: z.array(
        z.object({
            id: z.string().uuid(),
            isCleared: z.boolean(),
        }),
    ),
});

/* ─────────────────── GET /bank-reconciliations/paginated ─────────────────── */

export async function getPaginatedBankReconciliations(req: Request, res: Response) {
    try {
        const {
            pageIndex = 0,
            pageSize = 20,
            search = "",
            status = "",
            from,
            to,
            sort = "createdAt",
            order = "desc",
        } = req.query as Record<string, string>;

        const page = Number(pageIndex);
        const size = Number(pageSize);
        const offset = page * size;
        const scope = branchScope(bankReconciliations.branchId, req);

        const where = and(
            scope,
            search ? ilike(bankReconciliations.name, `%${search}%`) : undefined,
            status ? eq(bankReconciliations.status, status as any) : undefined,
            from ? gte(bankReconciliations.reconciliationDate, from) : undefined,
            to ? lte(bankReconciliations.reconciliationDate, to) : undefined,
        );

        const sortCol =
            sort === "reconciliationDate"
                ? bankReconciliations.reconciliationDate
                : sort === "name"
                  ? bankReconciliations.name
                  : bankReconciliations.createdAt;

        const rows = await db.query.bankReconciliations.findMany({
            where,
            orderBy: order === "asc" ? asc(sortCol) : desc(sortCol),
            limit: size,
            offset,
            with: {
                bankAccount: { columns: { id: true, code: true, name: true } },
                branch: { columns: { id: true, name: true, code: true } },
                createdByUser: { columns: { id: true, username: true, displayName: true } },
                reconciledByUser: { columns: { id: true, username: true, displayName: true } },
            },
        });

        const [{ count }] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(bankReconciliations)
            .where(where);

        return res.json({ rows, rowCount: count, pageCount: Math.ceil(count / size) });
    } catch (err) {
        console.error("[getPaginatedBankReconciliations]", err);
        return res.status(500).json({ message: "Failed to fetch bank reconciliations" });
    }
}

/* ─────────────────── GET /bank-reconciliations/:id ─────────────────── */

export async function getBankReconciliationById(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const recon = await db.query.bankReconciliations.findFirst({
            where: eq(bankReconciliations.id, id),
            with: {
                bankAccount: true,
                branch: true,
                createdByUser: { columns: { id: true, username: true, displayName: true } },
                reconciledByUser: { columns: { id: true, username: true, displayName: true } },
                items: {
                    orderBy: asc(bankReconciliationItems.transactionDate),
                },
            },
        });

        if (!recon) return res.status(404).json({ message: "Bank reconciliation not found" });
        return res.json(recon);
    } catch (err) {
        console.error("[getBankReconciliationById]", err);
        return res.status(500).json({ message: "Failed to fetch bank reconciliation" });
    }
}

/* ─────────────────── POST /bank-reconciliations ─────────────────── */

export async function createBankReconciliation(req: Request, res: Response) {
    try {
        const parsed = createBankReconciliationSchema.safeParse(req.body);
        if (!parsed.success)
            return res.status(400).json({ message: "Validation failed", errors: parsed.error.issues });

        const data = parsed.data;
        const branchId = await resolveBranchId(null, req);
        const branchCode = await resolveBranchCodeFromId(branchId);

        // Generate code
        const [lastRecon] = await db
            .select({ code: bankReconciliations.code })
            .from(bankReconciliations)
            .orderBy(desc(bankReconciliations.createdAt))
            .limit(1);

        const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        const lastSeq = lastRecon?.code
            ? parseInt(lastRecon.code.split("-").at(-1) || "0", 10)
            : 0;
        const nextSeq = String(lastSeq + 1).padStart(4, "0");
        const branchPart = branchCode ? `${branchCode.slice(0, 3).toUpperCase()}-` : "";
        const code = `${branchPart}BRC-${todayStr}-${nextSeq}`;

        // Find already reconciled journal entry IDs for this bank account
        const alreadyReconciled = await db
            .select({ journalEntryId: bankReconciliationItems.journalEntryId })
            .from(bankReconciliationItems)
            .innerJoin(
                bankReconciliations,
                eq(bankReconciliationItems.bankReconciliationId, bankReconciliations.id),
            )
            .where(
                and(
                    eq(bankReconciliations.status, "reconciled"),
                    eq(bankReconciliations.bankAccountId, data.bankAccountId),
                    eq(bankReconciliationItems.isCleared, true),
                    isNotNull(bankReconciliationItems.journalEntryId),
                ),
            );

        const reconciledEntryIdList = alreadyReconciled
            .map((r) => r.journalEntryId)
            .filter((id): id is string => Boolean(id));

        // Fetch candidate journal entries for this bank account up to reconciliationDate
        const entriesWhere = and(
            eq(journalEntries.glAccountId, data.bankAccountId),
            eq(journals.status, "posted"),
            lte(journals.date, data.reconciliationDate),
            reconciledEntryIdList.length > 0
                ? notInArray(journalEntries.id, reconciledEntryIdList)
                : undefined,
        );

        const candidateEntries = await db
            .select({
                id: journalEntries.id,
                debit: journalEntries.debit,
                credit: journalEntries.credit,
                note: journalEntries.note,
                date: journals.date,
                invoice: journals.invoice,
                description: journals.description,
            })
            .from(journalEntries)
            .innerJoin(journals, eq(journalEntries.journalId, journals.id))
            .where(entriesWhere)
            .orderBy(asc(journals.date));

        // Calculate opening balance if not explicitly provided
        let openingBalance = data.openingBalance;
        if (openingBalance === undefined || openingBalance === null) {
            // Calculate sum of all journal entries prior to reconciliationDate that are already reconciled
            // or starting balance
            const [priorSum] = await db
                .select({
                    totalDebit: sql<number>`coalesce(sum(${journalEntries.debit}), 0)`,
                    totalCredit: sql<number>`coalesce(sum(${journalEntries.credit}), 0)`,
                })
                .from(journalEntries)
                .innerJoin(journals, eq(journalEntries.journalId, journals.id))
                .where(
                    and(
                        eq(journalEntries.glAccountId, data.bankAccountId),
                        eq(journals.status, "posted"),
                        lte(journals.date, data.reconciliationDate),
                        reconciledEntryIdList.length > 0
                            ? inArray(journalEntries.id, reconciledEntryIdList)
                            : sql`1 = 0`,
                    ),
                );

            openingBalance = Number(priorSum?.totalDebit || 0) - Number(priorSum?.totalCredit || 0);
        }

        const clearedBalance = Number(openingBalance);
        const difference = Number(data.statementBalance) - clearedBalance;

        const result = await db.transaction(async (tx) => {
            const [created] = await tx
                .insert(bankReconciliations)
                .values({
                    code,
                    name: data.name,
                    bankAccountId: data.bankAccountId,
                    reconciliationDate: data.reconciliationDate,
                    openingBalance,
                    statementBalance: data.statementBalance,
                    clearedBalance,
                    difference,
                    status: "draft",
                    note: data.note ?? null,
                    branchId,
                    createdBy: req.user!.id,
                })
                .returning();

            if (candidateEntries.length > 0) {
                const itemsToInsert = candidateEntries.map((e) => ({
                    bankReconciliationId: created.id,
                    journalEntryId: e.id,
                    transactionDate: e.date,
                    reference: e.invoice,
                    description: e.note || e.description || null,
                    debit: Number(e.debit || 0),
                    credit: Number(e.credit || 0),
                    isCleared: false,
                }));

                await tx.insert(bankReconciliationItems).values(itemsToInsert);
            }

            return created;
        });

        logAction(req, {
            action: "insert",
            table: "bank_reconciliations",
            id: code,
            userId: req.user?.id,
            msg: `Created bank reconciliation ${code} (${data.name})`,
            data: result,
        });

        return res.status(201).json({ message: "Bank reconciliation created", id: result.id, code });
    } catch (err) {
        console.error("[createBankReconciliation]", err);
        return res.status(500).json({ message: "Failed to create bank reconciliation" });
    }
}

/* ─────────────────── PUT /bank-reconciliations/:id/items ─────────────────── */

export async function updateBankReconciliationItems(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const parsed = updateClearedItemsSchema.safeParse(req.body);
        if (!parsed.success)
            return res.status(400).json({ message: "Validation failed", errors: parsed.error.issues });

        const [recon] = await db
            .select()
            .from(bankReconciliations)
            .where(eq(bankReconciliations.id, id));

        if (!recon) return res.status(404).json({ message: "Bank reconciliation not found" });
        if (recon.status === "reconciled" || recon.status === "cancelled")
            return res.status(400).json({ message: "Cannot edit a reconciled or cancelled record" });

        // Update each item's isCleared status
        for (const item of parsed.data.items) {
            await db
                .update(bankReconciliationItems)
                .set({
                    isCleared: item.isCleared,
                    clearedAt: item.isCleared ? new Date() : null,
                    updatedAt: new Date(),
                })
                .where(
                    and(
                        eq(bankReconciliationItems.id, item.id),
                        eq(bankReconciliationItems.bankReconciliationId, id),
                    ),
                );
        }

        // Fetch all items to recalculate clearedBalance and difference
        const allItems = await db
            .select({
                debit: bankReconciliationItems.debit,
                credit: bankReconciliationItems.credit,
                isCleared: bankReconciliationItems.isCleared,
            })
            .from(bankReconciliationItems)
            .where(eq(bankReconciliationItems.bankReconciliationId, id));

        const clearedIn = allItems
            .filter((i) => i.isCleared)
            .reduce((sum, i) => sum + Number(i.debit), 0);
        const clearedOut = allItems
            .filter((i) => i.isCleared)
            .reduce((sum, i) => sum + Number(i.credit), 0);

        const clearedBalance = Number(recon.openingBalance) + clearedIn - clearedOut;
        const difference = Number(recon.statementBalance) - clearedBalance;

        await db
            .update(bankReconciliations)
            .set({
                clearedBalance,
                difference,
                updatedAt: new Date(),
            })
            .where(eq(bankReconciliations.id, id));

        return res.json({
            message: "Reconciliation items updated",
            clearedBalance,
            difference,
        });
    } catch (err) {
        console.error("[updateBankReconciliationItems]", err);
        return res.status(500).json({ message: "Failed to update reconciliation items" });
    }
}

/* ─────────────────── POST /bank-reconciliations/:id/reconcile ─────────────────── */

export async function reconcileBank(req: Request, res: Response) {
    try {
        const { id } = req.params;

        const [recon] = await db
            .select()
            .from(bankReconciliations)
            .where(eq(bankReconciliations.id, id));

        if (!recon) return res.status(404).json({ message: "Bank reconciliation not found" });
        if (recon.status === "reconciled")
            return res.status(400).json({ message: "Already reconciled" });
        if (recon.status === "cancelled")
            return res.status(400).json({ message: "Cannot reconcile a cancelled record" });

        await db
            .update(bankReconciliations)
            .set({
                status: "reconciled",
                reconciledBy: req.user!.id,
                reconciledAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(bankReconciliations.id, id));

        logAction(req, {
            action: "update",
            table: "bank_reconciliations",
            id: recon.code,
            userId: req.user?.id,
            msg: `Reconciled bank statement ${recon.code}`,
        });

        return res.json({ message: "Bank statement reconciled successfully" });
    } catch (err) {
        console.error("[reconcileBank]", err);
        return res.status(500).json({ message: "Failed to reconcile bank statement" });
    }
}

/* ─────────────────── POST /bank-reconciliations/:id/cancel ─────────────────── */

export async function cancelBankReconciliation(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const [recon] = await db
            .select()
            .from(bankReconciliations)
            .where(eq(bankReconciliations.id, id));

        if (!recon) return res.status(404).json({ message: "Bank reconciliation not found" });
        if (recon.status === "cancelled")
            return res.status(400).json({ message: "Already cancelled" });

        await db
            .update(bankReconciliations)
            .set({ status: "cancelled", updatedAt: new Date() })
            .where(eq(bankReconciliations.id, id));

        logAction(req, {
            action: "update",
            table: "bank_reconciliations",
            id: recon.code,
            userId: req.user?.id,
            msg: `Cancelled bank reconciliation ${recon.code}`,
        });

        return res.json({ message: "Bank reconciliation cancelled" });
    } catch (err) {
        console.error("[cancelBankReconciliation]", err);
        return res.status(500).json({ message: "Failed to cancel bank reconciliation" });
    }
}

/* ─────────────────── DELETE /bank-reconciliations/:id ─────────────────── */

export async function deleteBankReconciliation(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const [recon] = await db
            .select()
            .from(bankReconciliations)
            .where(eq(bankReconciliations.id, id));

        if (!recon) return res.status(404).json({ message: "Not found" });
        if (recon.status !== "draft")
            return res.status(400).json({ message: "Only draft bank reconciliations can be deleted" });

        await db.delete(bankReconciliations).where(eq(bankReconciliations.id, id));

        logAction(req, {
            action: "delete",
            table: "bank_reconciliations",
            id: recon.code,
            userId: req.user?.id,
            msg: `Deleted bank reconciliation ${recon.code}`,
        });

        return res.json({ message: "Deleted" });
    } catch (err) {
        console.error("[deleteBankReconciliation]", err);
        return res.status(500).json({ message: "Failed to delete" });
    }
}
