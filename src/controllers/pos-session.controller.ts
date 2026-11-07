import { db } from "@/db";
import { posSessions, transactions, users, payments, paymentLines, openInvoices, contacts } from "@/db/schemas";
import { Request, Response } from "express";
import { eq, and, isNull, desc, sql, or, ne, exists } from "drizzle-orm";
import { logAction } from "@/utils/log-helper";
import { getAccountBalance } from "@/repositories/gl-account.repository";
import { resolveBranchId } from "@/helpers/branch.helper";

export async function getAllSessions(req: Request, res: Response) {
    try {
        const userId = req.user!.id;
        const data = await db
            .select({
                id: posSessions.id,
                status: posSessions.status,
                openingBalance: posSessions.openingBalance,
                closingBalance: posSessions.closingBalance,
                openedAt: posSessions.openedAt,
                closedAt: posSessions.closedAt,
                userName: users.username,
                totalSales: sql<number>`COALESCE((SELECT SUM(total_amount) FROM transactions WHERE pos_session_id = ${posSessions.id}), 0)`,
            })
            .from(posSessions)
            .leftJoin(users, eq(users.id, posSessions.userId))
            .where(eq(posSessions.userId, userId))
            .orderBy(desc(posSessions.openedAt));

        res.status(200).json(data);
    } catch (error) {
        console.error("Error getting all POS sessions:", error);
        res.status(500).json({ message: "Failed to get sessions" });
    }
}

export async function getSessionSummary(req: Request, res: Response) {
    try {
        const { id } = req.params;

        // 1. Get session info
        const session = await db
            .select()
            .from(posSessions)
            .where(eq(posSessions.id, id))
            .limit(1)
            .then((r) => r[0]);

        if (!session) {
            return res.status(404).json({ message: "Session not found" });
        }

        // 2. Get transaction summary
        const summary = await db
            .select({
                count: sql<number>`count(*)`,
                totalAmount: sql<number>`COALESCE(sum(total_amount), 0)`,
                totalTax: sql<number>`COALESCE(sum(total_tax), 0)`,
                totalDiscount: sql<number>`COALESCE(sum(total_discount), 0)`,
            })
            .from(transactions)
            .where(eq(transactions.posSessionId, id))
            .then((r) => r[0]);

        const totalSales = Number(summary?.totalAmount || 0);

        // 3. Unpaid credit sales (Tempo / Bon) originated in this session
        const openInvoicesInSession = await db
            .select({
                totalAmount: sql<number>`COALESCE(SUM(${openInvoices.amount}), 0)::float`,
                paidAmount: sql<number>`COALESCE(SUM(${openInvoices.paidAmount}), 0)::float`,
            })
            .from(openInvoices)
            .innerJoin(transactions, eq(openInvoices.transactionId, transactions.id))
            .where(eq(transactions.posSessionId, id))
            .then((r) => r[0]);

        const creditSalesUnpaid = Math.max(
            0,
            Number(openInvoicesInSession?.totalAmount || 0) -
                Number(openInvoicesInSession?.paidAmount || 0),
        );

        // 4. Payments received in this session:
        // A) Payments directly tagged with posSessionId (includes settlements and checkouts)
        // B) Or payments through openInvoices where transaction.posSessionId = id (backward compat)
        const sessionPayments = await db
            .select({
                method: sql<string>`COALESCE(${payments.reference}, 'Cash')`,
                total: sql<number>`COALESCE(SUM(${payments.totalAmount}), 0)::float`,
            })
            .from(payments)
            .where(
                or(
                    eq(payments.posSessionId, id),
                    exists(
                        db
                            .select()
                            .from(paymentLines)
                            .innerJoin(
                                openInvoices,
                                eq(paymentLines.openInvoiceId, openInvoices.id),
                            )
                            .innerJoin(
                                transactions,
                                eq(openInvoices.transactionId, transactions.id),
                            )
                            .where(
                                and(
                                    eq(paymentLines.paymentId, payments.id),
                                    eq(transactions.posSessionId, id),
                                    isNull(payments.posSessionId),
                                ),
                            ),
                    ),
                ),
            )
            .groupBy(sql`COALESCE(${payments.reference}, 'Cash')`);

        // 5. Separate settlement payments (pelunasan nota luar sesi yang diterima di sesi ini)
        const settlementsInSession = await db
            .select({
                method: sql<string>`COALESCE(${payments.reference}, 'Cash')`,
                total: sql<number>`COALESCE(SUM(${payments.totalAmount}), 0)::float`,
            })
            .from(payments)
            .innerJoin(paymentLines, eq(paymentLines.paymentId, payments.id))
            .innerJoin(openInvoices, eq(paymentLines.openInvoiceId, openInvoices.id))
            .leftJoin(transactions, eq(openInvoices.transactionId, transactions.id))
            .where(
                and(
                    eq(payments.posSessionId, id),
                    or(
                        ne(transactions.posSessionId, id),
                        isNull(transactions.posSessionId),
                    ),
                ),
            )
            .groupBy(sql`COALESCE(${payments.reference}, 'Cash')`);

        const totalSettlements = settlementsInSession.reduce(
            (sum, s) => sum + Number(s.total || 0),
            0,
        );

        let paymentBreakdown = [...sessionPayments];
        if (!paymentBreakdown || paymentBreakdown.length === 0) {
            paymentBreakdown = await db
                .select({
                    method: sql<string>`COALESCE(${transactions.reference}, 'Cash')`,
                    total: sql<number>`COALESCE(SUM(${transactions.totalAmount}), 0)::float`,
                })
                .from(transactions)
                .where(eq(transactions.posSessionId, id))
                .groupBy(sql`COALESCE(${transactions.reference}, 'Cash')`);
        }

        // Add credit sales (Tempo) to breakdown if any
        if (creditSalesUnpaid > 0) {
            paymentBreakdown.push({
                method: "Tempo / Bon (Piutang)",
                total: creditSalesUnpaid,
            });
        }

        const cashCollected = (paymentBreakdown || [])
            .filter((p) => {
                const m = (p.method || "").toLowerCase();
                return (
                    (m.includes("cash") || m.includes("tunai") || m.includes("kas")) &&
                    !m.includes("tempo") &&
                    !m.includes("bon") &&
                    !m.includes("piutang")
                );
            })
            .reduce((sum, p) => sum + Number(p.total || 0), 0);

        const expectedCash = Number(session.openingBalance || 0) + cashCollected;

        const transactionsList = await db
            .select({
                id: transactions.id,
                invoice: transactions.invoice,
                date: transactions.date,
                subtotal: transactions.subtotal,
                totalDiscount: transactions.totalDiscount,
                totalTax: transactions.totalTax,
                totalAmount: transactions.totalAmount,
                status: transactions.status,
                reference: transactions.reference,
                createdAt: transactions.createdAt,
                customerName: contacts.name,
            })
            .from(transactions)
            .leftJoin(contacts, eq(transactions.contactId, contacts.id))
            .where(eq(transactions.posSessionId, id))
            .orderBy(desc(transactions.createdAt));

        res.status(200).json({
            session,
            summary: {
                ...summary,
                totalAmount: totalSales,
                creditSales: creditSalesUnpaid,
                totalSettlements,
                cashCollected,
                expectedCash,
            },
            paymentBreakdown,
            settlements: settlementsInSession,
            transactions: transactionsList,
        });
    } catch (error) {
        console.error("Error getting session summary:", error);
        res.status(500).json({ message: "Failed to get session summary" });
    }
}

export async function getActiveSession(req: Request, res: Response) {
    try {
        const userId = req.user!.id;
        const session = await db
            .select()
            .from(posSessions)
            .where(
                and(
                    eq(posSessions.userId, userId),
                    eq(posSessions.status, "open"),
                ),
            )
            .limit(1)
            .then((r) => r[0]);

        if (!session) {
            return res.status(200).json(null);
        }

        res.status(200).json(session);
    } catch (error) {
        console.error("Error getting active POS session:", error);
        res.status(500).json({ message: "Failed to get active session" });
    }
}

export async function getOpeningBalance(req: Request, res: Response) {
    try {
        const userId = req.user!.id;
        const user = await db
            .select()
            .from(users)
            .where(eq(users.id, userId))
            .limit(1)
            .then((r) => r[0]);

        let balance = 0;
        if (user?.cashGlAccountId) {
            balance = await getAccountBalance(user.cashGlAccountId);
        }

        res.status(200).json({ balance });
    } catch (error) {
        console.error("Error getting opening balance:", error);
        res.status(500).json({ message: "Failed to get opening balance" });
    }
}

export async function openSession(req: Request, res: Response) {
    try {
        const userId = req.user!.id;

        // Check if there's already an active session
        const existing = await db
            .select()
            .from(posSessions)
            .where(
                and(
                    eq(posSessions.userId, userId),
                    eq(posSessions.status, "open"),
                ),
            )
            .limit(1)
            .then((r) => r[0]);

        if (existing) {
            return res
                .status(400)
                .json({ message: "You already have an active session" });
        }

        // Get user's cash GL account and its balance
        const user = await db
            .select()
            .from(users)
            .where(eq(users.id, userId))
            .limit(1)
            .then((r) => r[0]);

        if (!user?.cashGlAccountId || !user?.posWarehouseId) {
            return res.status(400).json({ 
                message: "Setup POS belum lengkap. Silakan konfigurasi 'Akun GL Kas' dan 'Gudang POS' di pengaturan profil Anda." 
            });
        }

        let openingBalance = 0;
        if (user?.cashGlAccountId) {
            openingBalance = await getAccountBalance(user.cashGlAccountId);
        }

        const [session] = await db
            .insert(posSessions)
            .values({
                userId,
                branchId: await resolveBranchId(
                    req.activeBranchId || user?.branchId,
                    req,
                ),
                openingBalance,
                status: "open",
                openedAt: new Date(),
            })
            .returning();

        logAction(req, {
            action: "insert",
            table: "pos_sessions",
            data: session,
            userId,
            msg: `opened POS session with balance ${openingBalance}`,
        });

        res.status(201).json(session);
    } catch (error) {
        console.error("Error opening POS session:", error);
        res.status(500).json({ message: "Failed to open session" });
    }
}

export async function closeSession(req: Request, res: Response) {
    try {
        const userId = req.user!.id;
        const { id } = req.params;
        const { closingBalance } = req.body;

        const [session] = await db
            .update(posSessions)
            .set({
                status: "closed",
                closingBalance: Number(closingBalance) || 0,
                closedAt: new Date(),
            })
            .where(
                and(
                    eq(posSessions.id, id),
                    eq(posSessions.userId, userId),
                    eq(posSessions.status, "open")
                )
            )
            .returning();

        if (!session) {
            return res.status(404).json({ message: "Active session not found" });
        }

        logAction(req, {
            action: "update",
            table: "pos_sessions",
            data: session,
            userId,
            msg: `closed POS session with balance ${closingBalance}`,
        });

        res.status(200).json(session);
    } catch (error) {
        console.error("Error closing POS session:", error);
        res.status(500).json({ message: "Failed to close session" });
    }
}
