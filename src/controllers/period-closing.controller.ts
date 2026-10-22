import { Request, Response } from "express";
import { db } from "@/db";
import {
    glAccounts,
    journalEntries,
    journals,
    periodClosings,
    settings,
    users,
} from "@/db/schemas";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { branchScope, resolveBranchCodeFromId } from "@/helpers/branch.helper";
import { generateJournalInvoice } from "@/helpers/generate-invoice";
import { logAction } from "@/utils/log-helper";
import { AppError } from "@/middleware/error-handler";

/**
 * Helper to get the default or configured Retained Earnings account
 */
async function getRetainedEarningsAccount(customAccountId?: string) {
    if (customAccountId) {
        const [acc] = await db
            .select()
            .from(glAccounts)
            .where(eq(glAccounts.id, customAccountId))
            .limit(1);
        if (acc) return acc;
    }

    // Try from global settings
    const globalSettings = await db.query.settings.findFirst({
        where: eq(settings.id, "global"),
    });

    if (globalSettings?.retainedEarningsGlAccountId) {
        const [acc] = await db
            .select()
            .from(glAccounts)
            .where(eq(glAccounts.id, globalSettings.retainedEarningsGlAccountId))
            .limit(1);
        if (acc) return acc;
    }

    // Fallback: search for 3200 or any equity account with "Laba Ditahan" or "Retained Earnings"
    const [fallback] = await db
        .select()
        .from(glAccounts)
        .where(
            and(
                eq(glAccounts.type, "equity"),
                sql`LOWER(${glAccounts.name}) LIKE '%laba ditahan%' OR ${glAccounts.code} = '3200'`
            )
        )
        .limit(1);

    return fallback || null;
}

/**
 * GET /api/period-closing/overview
 */
export const getPeriodClosingOverview = async (req: Request, res: Response) => {
    try {
        const globalSettings = await db.query.settings.findFirst({
            where: eq(settings.id, "global"),
        });

        const retainedEarningsAccount = await getRetainedEarningsAccount();

        const history = await db
            .select({
                id: periodClosings.id,
                startDate: periodClosings.startDate,
                endDate: periodClosings.endDate,
                totalIncome: periodClosings.totalIncome,
                totalExpense: periodClosings.totalExpense,
                netProfit: periodClosings.netProfit,
                status: periodClosings.status,
                notes: periodClosings.notes,
                closedAt: periodClosings.closedAt,
                reopenedAt: periodClosings.reopenedAt,
                reopenReason: periodClosings.reopenReason,
                closingJournalId: periodClosings.closingJournalId,
                closingJournalInvoice: journals.invoice,
                closedByName: sql<string>`COALESCE(${users.displayName}, ${users.username})`,
            })
            .from(periodClosings)
            .leftJoin(journals, eq(periodClosings.closingJournalId, journals.id))
            .leftJoin(users, eq(periodClosings.closedBy, users.id))
            .orderBy(desc(periodClosings.endDate), desc(periodClosings.createdAt));

        // Next suggested period
        const closingDate = globalSettings?.closingDate;
        let suggestedStart: string | null = null;
        let suggestedEnd: string | null = null;

        const now = new Date();
        const firstDayOfCurrentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

        const formatDateYMD = (d: Date): string => {
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, "0");
            const day = String(d.getDate()).padStart(2, "0");
            return `${year}-${month}-${day}`;
        };

        if (closingDate) {
            const [cy, cm, cd] = closingDate.split("-").map(Number);
            const nextStart = new Date(cy, cm - 1, cd + 1);
            const nextEnd = new Date(nextStart.getFullYear(), nextStart.getMonth() + 1, 0);

            const nextStartStr = formatDateYMD(nextStart);
            const nextEndStr = formatDateYMD(nextEnd);

            // Only suggest if the period is completed (before current month)
            if (nextEndStr < firstDayOfCurrentMonth) {
                suggestedStart = nextStartStr;
                suggestedEnd = nextEndStr;
            }
        } else {
            // First time: suggest the previous completed month
            const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

            suggestedStart = formatDateYMD(prevMonthStart);
            suggestedEnd = formatDateYMD(prevMonthEnd);
        }

        res.json({
            currentClosingDate: closingDate || null,
            retainedEarningsAccount,
            nextSuggestedPeriod:
                suggestedStart && suggestedEnd
                    ? {
                          startDate: suggestedStart,
                          endDate: suggestedEnd,
                      }
                    : null,
            history,
        });
    } catch (error: any) {
        console.error("Error fetching period closing overview:", error);
        res.status(500).json({
            message: "Failed to fetch period closing overview",
            error: error.message,
        });
    }
};

/**
 * GET /api/period-closing/preview?startDate=...&endDate=...
 */
export const previewPeriodClosing = async (req: Request, res: Response) => {
    try {
        const { startDate, endDate } = req.query;

        if (!startDate || !endDate) {
            return res.status(400).json({ message: "startDate and endDate are required" });
        }

        const startStr = String(startDate).split("T")[0];
        const endStr = String(endDate).split("T")[0];

        if (startStr > endStr) {
            return res.status(400).json({ message: "startDate must be before or equal to endDate" });
        }

        // Prevent closing the current month
        const now = new Date();
        const firstDayOfCurrentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
        if (endStr >= firstDayOfCurrentMonth) {
            return res.status(400).json({
                message: `Tidak dapat menutup periode yang masih berjalan. Tanggal akhir penutupan harus sebelum ${firstDayOfCurrentMonth} (awal bulan ini).`,
            });
        }

        const globalSettings = await db.query.settings.findFirst({
            where: eq(settings.id, "global"),
        });

        if (globalSettings?.closingDate && endStr <= globalSettings.closingDate) {
            return res.status(400).json({
                message: `This period is already closed (Locked until ${globalSettings.closingDate})`,
            });
        }

        const scope = branchScope(journals.branchId, req);

        // Check for unposted journals in date range
        const unpostedJournals = await db
            .select({
                id: journals.id,
                invoice: journals.invoice,
                date: journals.date,
                description: journals.description,
            })
            .from(journals)
            .where(
                and(
                    eq(journals.status, "draft"),
                    gte(journals.date, startStr),
                    lte(journals.date, endStr),
                    scope
                )
            )
            .limit(10);

        const warnings: string[] = [];
        if (unpostedJournals.length > 0) {
            warnings.push(
                `Found ${unpostedJournals.length} unposted/draft journal(s) in this period. Please post or cancel them before closing.`
            );
        }

        // Query Income & Expense balances
        const balances = await db
            .select({
                accountId: glAccounts.id,
                accountCode: glAccounts.code,
                accountName: glAccounts.name,
                accountType: glAccounts.type,
                totalDebit: sql<number>`COALESCE(sum(${journalEntries.debit}), 0)`,
                totalCredit: sql<number>`COALESCE(sum(${journalEntries.credit}), 0)`,
            })
            .from(journalEntries)
            .innerJoin(journals, eq(journalEntries.journalId, journals.id))
            .innerJoin(glAccounts, eq(journalEntries.glAccountId, glAccounts.id))
            .where(
                and(
                    eq(journals.status, "posted"),
                    gte(journals.date, startStr),
                    lte(journals.date, endStr),
                    inArray(glAccounts.type, ["income", "expense"]),
                    sql`${journals.id} NOT IN (SELECT closing_journal_id FROM period_closings WHERE closing_journal_id IS NOT NULL AND status = 'closed')`,
                    scope
                )
            )
            .groupBy(glAccounts.id, glAccounts.code, glAccounts.name, glAccounts.type)
            .orderBy(asc(glAccounts.code));

        const incomeAccounts = balances
            .filter((b) => b.accountType === "income")
            .map((b) => {
                const balance = Number(b.totalCredit || 0) - Number(b.totalDebit || 0);
                return {
                    accountId: b.accountId,
                    accountCode: b.accountCode,
                    accountName: b.accountName,
                    balance,
                    closeDebit: balance > 0 ? balance : 0,
                    closeCredit: balance < 0 ? Math.abs(balance) : 0,
                };
            });

        const expenseAccounts = balances
            .filter((b) => b.accountType === "expense")
            .map((b) => {
                const balance = Number(b.totalDebit || 0) - Number(b.totalCredit || 0);
                return {
                    accountId: b.accountId,
                    accountCode: b.accountCode,
                    accountName: b.accountName,
                    balance,
                    closeDebit: balance < 0 ? Math.abs(balance) : 0,
                    closeCredit: balance > 0 ? balance : 0,
                };
            });

        const totalIncome = incomeAccounts.reduce((sum, a) => sum + a.balance, 0);
        const totalExpense = expenseAccounts.reduce((sum, a) => sum + a.balance, 0);
        const netProfit = totalIncome - totalExpense;

        const retainedEarningsAccount = await getRetainedEarningsAccount();

        res.json({
            startDate: startStr,
            endDate: endStr,
            totalIncome,
            totalExpense,
            netProfit,
            incomeAccounts,
            expenseAccounts,
            warnings,
            unpostedJournals,
            retainedEarningsAccount,
            canExecute: warnings.length === 0,
        });
    } catch (error: any) {
        console.error("Error previewing period closing:", error);
        res.status(500).json({
            message: "Failed to preview period closing",
            error: error.message,
        });
    }
};

/**
 * POST /api/period-closing/close
 */
export const executePeriodClosing = async (req: Request, res: Response) => {
    try {
        const { startDate, endDate, notes, retainedEarningsAccountId } = req.body;

        if (!startDate || !endDate) {
            return res.status(400).json({ message: "startDate and endDate are required" });
        }

        const startStr = String(startDate).split("T")[0];
        const endStr = String(endDate).split("T")[0];

        // Prevent closing the current month
        const now = new Date();
        const firstDayOfCurrentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
        if (endStr >= firstDayOfCurrentMonth) {
            return res.status(400).json({
                message: `Tidak dapat menutup periode yang masih berjalan. Tanggal akhir penutupan harus sebelum ${firstDayOfCurrentMonth} (awal bulan ini).`,
            });
        }

        const globalSettings = await db.query.settings.findFirst({
            where: eq(settings.id, "global"),
        });

        if (globalSettings?.closingDate && endStr <= globalSettings.closingDate) {
            return res.status(400).json({
                message: `This period is already closed (Locked until ${globalSettings.closingDate})`,
            });
        }

        const retainedAccount = await getRetainedEarningsAccount(retainedEarningsAccountId);
        if (!retainedAccount) {
            return res.status(400).json({
                message: "Retained Earnings (Laba Ditahan) account is not configured.",
            });
        }

        const branchId = req.activeBranchId || (req.user as any)?.branchId || null;
        const branchCode = await resolveBranchCodeFromId(branchId);

        // Check for unposted draft journals
        const [unpostedCount] = await db
            .select({ count: sql<number>`count(*)` })
            .from(journals)
            .where(
                and(
                    eq(journals.status, "draft"),
                    gte(journals.date, startStr),
                    lte(journals.date, endStr)
                )
            );

        if (Number(unpostedCount?.count || 0) > 0) {
            return res.status(400).json({
                message: `Cannot close period with ${unpostedCount.count} unposted draft journal(s). Please post or cancel them first.`,
            });
        }

        const result = await db.transaction(async (tx) => {
            // 1. Calculate balances
            const balances = await tx
                .select({
                    accountId: glAccounts.id,
                    accountCode: glAccounts.code,
                    accountName: glAccounts.name,
                    accountType: glAccounts.type,
                    totalDebit: sql<number>`COALESCE(sum(${journalEntries.debit}), 0)`,
                    totalCredit: sql<number>`COALESCE(sum(${journalEntries.credit}), 0)`,
                })
                .from(journalEntries)
                .innerJoin(journals, eq(journalEntries.journalId, journals.id))
                .innerJoin(glAccounts, eq(journalEntries.glAccountId, glAccounts.id))
                .where(
                    and(
                        eq(journals.status, "posted"),
                        gte(journals.date, startStr),
                        lte(journals.date, endStr),
                        inArray(glAccounts.type, ["income", "expense"]),
                        sql`${journals.id} NOT IN (SELECT closing_journal_id FROM period_closings WHERE closing_journal_id IS NOT NULL AND status = 'closed')`
                    )
                )
                .groupBy(glAccounts.id, glAccounts.code, glAccounts.name, glAccounts.type);

            let totalIncome = 0;
            let totalExpense = 0;
            const entriesToInsert: Array<{
                glAccountId: string;
                debit: number;
                credit: number;
                note: string;
            }> = [];

            for (const b of balances) {
                if (b.accountType === "income") {
                    const balance = Number(b.totalCredit || 0) - Number(b.totalDebit || 0);
                    totalIncome += balance;
                    if (balance !== 0) {
                        entriesToInsert.push({
                            glAccountId: b.accountId,
                            debit: balance > 0 ? balance : 0,
                            credit: balance < 0 ? Math.abs(balance) : 0,
                            note: `Closing entry: ${b.accountCode} - ${b.accountName}`,
                        });
                    }
                } else if (b.accountType === "expense") {
                    const balance = Number(b.totalDebit || 0) - Number(b.totalCredit || 0);
                    totalExpense += balance;
                    if (balance !== 0) {
                        entriesToInsert.push({
                            glAccountId: b.accountId,
                            debit: balance < 0 ? Math.abs(balance) : 0,
                            credit: balance > 0 ? balance : 0,
                            note: `Closing entry: ${b.accountCode} - ${b.accountName}`,
                        });
                    }
                }
            }

            const netProfit = totalIncome - totalExpense;

            // Retained Earnings balancing entry
            if (netProfit > 0) {
                // Profit: Credit Retained Earnings
                entriesToInsert.push({
                    glAccountId: retainedAccount.id,
                    debit: 0,
                    credit: netProfit,
                    note: `Net Profit transferred to ${retainedAccount.name}`,
                });
            } else if (netProfit < 0) {
                // Loss: Debit Retained Earnings
                entriesToInsert.push({
                    glAccountId: retainedAccount.id,
                    debit: Math.abs(netProfit),
                    credit: 0,
                    note: `Net Loss transferred to ${retainedAccount.name}`,
                });
            }

            let closingJournalId: string | null = null;

            // 2. Insert Closing Journal if there are entries
            if (entriesToInsert.length > 0) {
                const invoice = await generateJournalInvoice("closing", branchCode);

                const [closingJournal] = await tx
                    .insert(journals)
                    .values({
                        invoice,
                        date: endStr,
                        description: `Closing Journal for Period ${startStr} to ${endStr}`,
                        status: "posted",
                        branchId,
                    })
                    .returning();

                closingJournalId = closingJournal.id;

                for (const entry of entriesToInsert) {
                    await tx.insert(journalEntries).values({
                        journalId: closingJournal.id,
                        glAccountId: entry.glAccountId,
                        debit: entry.debit,
                        credit: entry.credit,
                        note: entry.note,
                    });
                }
            }

            // 3. Record in period_closings table
            const [closingRecord] = await tx
                .insert(periodClosings)
                .values({
                    branchId,
                    startDate: startStr,
                    endDate: endStr,
                    closingJournalId,
                    totalIncome,
                    totalExpense,
                    netProfit,
                    status: "closed",
                    notes,
                    closedBy: req.user?.id,
                    closedAt: new Date(),
                })
                .returning();

            // 4. Update settings.closingDate
            await tx
                .update(settings)
                .set({
                    closingDate: endStr,
                    updatedAt: new Date(),
                })
                .where(eq(settings.id, "global"));

            return {
                closingRecord,
                closingJournalId,
                netProfit,
                totalIncome,
                totalExpense,
            };
        });

        logAction(req, {
            action: "insert",
            table: "period_closings",
            data: result.closingRecord,
            userId: req.user!.id,
            msg: `Executed period closing for ${startStr} to ${endStr}`,
        });

        res.json({
            message: "Period closed successfully",
            ...result,
        });
    } catch (error: any) {
        console.error("Error executing period closing:", error);
        res.status(500).json({
            message: "Failed to execute period closing",
            error: error.message,
        });
    }
};

/**
 * POST /api/period-closing/reopen
 */
export const reopenPeriodClosing = async (req: Request, res: Response) => {
    try {
        const { id, reason } = req.body;

        if (!id) {
            return res.status(400).json({ message: "Period closing id is required" });
        }

        const [closingRecord] = await db
            .select()
            .from(periodClosings)
            .where(eq(periodClosings.id, id))
            .limit(1);

        if (!closingRecord) {
            return res.status(404).json({ message: "Period closing record not found" });
        }

        if (closingRecord.status === "reopened") {
            return res.status(400).json({ message: "This period has already been reopened" });
        }

        // Must be the most recent closed period
        const [latestActive] = await db
            .select()
            .from(periodClosings)
            .where(eq(periodClosings.status, "closed"))
            .orderBy(desc(periodClosings.endDate))
            .limit(1);

        if (latestActive && latestActive.id !== closingRecord.id) {
            return res.status(400).json({
                message: `You can only reopen the most recent closed period (${latestActive.startDate} to ${latestActive.endDate}). Reopen that first.`,
            });
        }

        await db.transaction(async (tx) => {
            // 1. Cancel the closing journal if generated
            if (closingRecord.closingJournalId) {
                await tx
                    .update(journals)
                    .set({
                        status: "cancelled",
                        description: sql`CONCAT(${journals.description}, ' [CANCELLED VIA REOPEN]')`,
                        updatedAt: new Date(),
                    })
                    .where(eq(journals.id, closingRecord.closingJournalId));
            }

            // 2. Mark closing record as reopened
            await tx
                .update(periodClosings)
                .set({
                    status: "reopened",
                    reopenedBy: req.user?.id,
                    reopenedAt: new Date(),
                    reopenReason: reason || "Administrative period reopening",
                    updatedAt: new Date(),
                })
                .where(eq(periodClosings.id, id));

            // 3. Roll back closing date in settings to the previous active closed period (or null)
            const [previousActive] = await tx
                .select()
                .from(periodClosings)
                .where(
                    and(
                        eq(periodClosings.status, "closed"),
                        sql`${periodClosings.id} != ${id}`
                    )
                )
                .orderBy(desc(periodClosings.endDate))
                .limit(1);

            const newClosingDate = previousActive ? previousActive.endDate : null;

            await tx
                .update(settings)
                .set({
                    closingDate: newClosingDate,
                    updatedAt: new Date(),
                })
                .where(eq(settings.id, "global"));
        });

        logAction(req, {
            action: "update",
            table: "period_closings",
            data: { id, reason },
            userId: req.user!.id,
            msg: `Reopened period closing for ${closingRecord.startDate} to ${closingRecord.endDate}`,
        });

        res.json({
            message: "Period reopened successfully. The lock has been rolled back.",
        });
    } catch (error: any) {
        console.error("Error reopening period closing:", error);
        res.status(500).json({
            message: "Failed to reopen period closing",
            error: error.message,
        });
    }
};
