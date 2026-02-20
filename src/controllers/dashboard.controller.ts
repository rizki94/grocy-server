import { db } from "@/db";
import { transactions, stocks, openInvoices } from "@/db/schemas";
import { and, eq, gte, sql, desc } from "drizzle-orm";
import { Request, Response } from "express";

export const getDashboardStats = async (req: Request, res: Response) => {
    try {
        const today = new Date();
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const startOfLastMonth = new Date(
            today.getFullYear(),
            today.getMonth() - 1,
            1,
        );
        const endOfLastMonth = new Date(
            today.getFullYear(),
            today.getMonth(),
            0,
        );

        // Sales stats
        const [salesThisMonth] = await db
            .select({
                count: sql<number>`count(*)`,
                total: sql<number>`COALESCE(sum(${transactions.totalAmount}), 0)`,
            })
            .from(transactions)
            .where(
                and(
                    eq(transactions.type, "sales"),
                    eq(transactions.status, "posted"),
                    gte(
                        transactions.date,
                        startOfMonth.toISOString().split("T")[0],
                    ),
                ),
            );

        const [salesLastMonth] = await db
            .select({
                total: sql<number>`COALESCE(sum(${transactions.totalAmount}), 0)`,
            })
            .from(transactions)
            .where(
                and(
                    eq(transactions.type, "sales"),
                    eq(transactions.status, "posted"),
                    gte(
                        transactions.date,
                        startOfLastMonth.toISOString().split("T")[0],
                    ),
                    sql`${transactions.date} <= ${endOfLastMonth.toISOString().split("T")[0]}`,
                ),
            );

        // Purchase stats
        const [purchasesThisMonth] = await db
            .select({
                count: sql<number>`count(*)`,
                total: sql<number>`COALESCE(sum(${transactions.totalAmount}), 0)`,
            })
            .from(transactions)
            .where(
                and(
                    eq(transactions.type, "purchase"),
                    eq(transactions.status, "posted"),
                    gte(
                        transactions.date,
                        startOfMonth.toISOString().split("T")[0],
                    ),
                ),
            );

        // Pending invoices
        const [receivables] = await db
            .select({
                count: sql<number>`count(*)`,
                total: sql<number>`COALESCE(sum(${openInvoices.amount} - ${openInvoices.paidAmount}), 0)`,
            })
            .from(openInvoices)
            .where(
                and(
                    eq(openInvoices.type, "receivable"),
                    eq(openInvoices.status, "open"),
                ),
            );

        const [payables] = await db
            .select({
                count: sql<number>`count(*)`,
                total: sql<number>`COALESCE(sum(${openInvoices.amount} - ${openInvoices.paidAmount}), 0)`,
            })
            .from(openInvoices)
            .where(
                and(
                    eq(openInvoices.type, "payable"),
                    eq(openInvoices.status, "open"),
                ),
            );

        // Low stock items
        const lowStockItems = await db
            .select({
                productId: stocks.productId,
                qty: stocks.qty,
            })
            .from(stocks)
            .where(sql`${stocks.qty} < 10`)
            .limit(5);

        // Recent transactions
        const recentTransactions = await db
            .select({
                id: transactions.id,
                type: transactions.type,
                invoice: transactions.invoice,
                date: transactions.date,
                totalAmount: transactions.totalAmount,
                status: transactions.status,
            })
            .from(transactions)
            .orderBy(desc(transactions.createdAt))
            .limit(5);

        // Calculate growth percentages
        const salesGrowth =
            salesLastMonth.total > 0
                ? ((Number(salesThisMonth.total) -
                      Number(salesLastMonth.total)) /
                      Number(salesLastMonth.total)) *
                  100
                : 0;

        res.json({
            sales: {
                thisMonth: {
                    count: Number(salesThisMonth.count),
                    total: Number(salesThisMonth.total),
                },
                growth: salesGrowth,
            },
            purchases: {
                thisMonth: {
                    count: Number(purchasesThisMonth.count),
                    total: Number(purchasesThisMonth.total),
                },
            },
            invoices: {
                receivables: {
                    count: Number(receivables.count),
                    total: Number(receivables.total),
                },
                payables: {
                    count: Number(payables.count),
                    total: Number(payables.total),
                },
            },
            lowStockItems: lowStockItems.map((item) => ({
                productId: item.productId,
                qty: Number(item.qty),
            })),
            recentTransactions: recentTransactions.map((t) => ({
                ...t,
                totalAmount: Number(t.totalAmount),
            })),
        });
    } catch (error) {
        console.error("Error fetching dashboard stats:", error);
        res.status(500).json({ message: "Failed to fetch dashboard stats" });
    }
};
