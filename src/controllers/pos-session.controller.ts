import { db } from "@/db";
import { posSessions, transactions, users } from "@/db/schemas";
import { Request, Response } from "express";
import { eq, and, isNull, desc, sql } from "drizzle-orm";
import { logAction } from "@/utils/log-helper";

export async function getAllSessions(req: Request, res: Response) {
    try {
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
            .then(r => r[0]);

        if (!session) {
            return res.status(404).json({ message: "Session not found" });
        }

        // 2. Get transaction summary
        const summary = await db
            .select({
                count: sql<number>`count(*)`,
                totalAmount: sql<number>`sum(total_amount)`,
                totalTax: sql<number>`sum(total_tax)`,
                totalDiscount: sql<number>`sum(total_discount)`,
            })
            .from(transactions)
            .where(eq(transactions.posSessionId, id))
            .then(r => r[0]);

        // 3. Get payment breakdown
        const paymentBreakdown = await db
            .select({
                method: transactions.reference,
                total: sql<number>`sum(total_amount)`,
            })
            .from(transactions)
            .where(eq(transactions.posSessionId, id))
            .groupBy(transactions.reference);

        const transactionsList = await db
            .select()
            .from(transactions)
            .where(eq(transactions.posSessionId, id))
            .orderBy(desc(transactions.createdAt));

        res.status(200).json({
            session,
            summary,
            paymentBreakdown,
            transactions: transactionsList
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
                    eq(posSessions.status, "open")
                )
            )
            .limit(1)
            .then(r => r[0]);

        if (!session) {
            return res.status(200).json(null);
        }

        res.status(200).json(session);
    } catch (error) {
        console.error("Error getting active POS session:", error);
        res.status(500).json({ message: "Failed to get active session" });
    }
}

export async function openSession(req: Request, res: Response) {
    try {
        const userId = req.user!.id;
        const { openingBalance } = req.body;

        // Check if there's already an active session
        const existing = await db
            .select()
            .from(posSessions)
            .where(
                and(
                    eq(posSessions.userId, userId),
                    eq(posSessions.status, "open")
                )
            )
            .limit(1)
            .then(r => r[0]);

        if (existing) {
            return res.status(400).json({ message: "You already have an active session" });
        }

        const [session] = await db
            .insert(posSessions)
            .values({
                userId,
                openingBalance: Number(openingBalance) || 0,
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
