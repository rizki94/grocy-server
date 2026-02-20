import { Request, Response } from "express";
import { db } from "@/db";
import {
    glAccounts,
    journalEntries,
    journals,
    products,
    transactionDetails,
    transactions,
} from "@/db/schemas";
import { and, eq, sql, gte, lte, desc, inArray } from "drizzle-orm";

export const getProfitLoss = async (req: Request, res: Response) => {
    try {
        const { from, to } = req.query;
        const fromDate = from
            ? (from as string).split("T")[0]
            : new Date(new Date().getFullYear(), 0, 1)
                .toISOString()
                .split("T")[0];
        const toDate = to
            ? (to as string).split("T")[0]
            : new Date().toISOString().split("T")[0];

        const report = await db
            .select({
                accountName: glAccounts.name,
                accountType: glAccounts.type,
                debit: sql<number>`COALESCE(sum(${journalEntries.debit}), 0)`,
                credit: sql<number>`COALESCE(sum(${journalEntries.credit}), 0)`,
            })
            .from(journalEntries)
            .innerJoin(journals, eq(journalEntries.journalId, journals.id))
            .innerJoin(
                glAccounts,
                eq(journalEntries.glAccountId, glAccounts.id),
            )
            .where(
                and(
                    eq(journals.status, "posted"),
                    gte(journals.date, fromDate),
                    lte(journals.date, toDate),
                    inArray(glAccounts.type, ["income", "expense"]),
                ),
            )
            .groupBy(glAccounts.id, glAccounts.name, glAccounts.type);

        const income = report.filter((r) => r.accountType === "income");
        const expense = report.filter((r) => r.accountType === "expense");

        const totalIncome = income.reduce(
            (sum, r) => sum + (Number(r.credit || 0) - Number(r.debit || 0)),
            0,
        );
        const totalExpense = expense.reduce(
            (sum, r) => sum + (Number(r.debit || 0) - Number(r.credit || 0)),
            0,
        );

        res.json({
            income,
            expense,
            totalIncome,
            totalExpense,
            netProfit: totalIncome - totalExpense,
        });
    } catch (error: any) {
        console.error("Profit Loss Error:", error);
        res.status(500).json({
            message: "Failed to generate Profit & Loss report",
            error: error.message,
        });
    }
};

export const getBalanceSheet = async (req: Request, res: Response) => {
    try {
        const { date } = req.query;
        const toDate = (typeof date === 'string' ? date : String(date || '')).split("T")[0] ||
            new Date().toISOString().split("T")[0];

        console.log(`[getBalanceSheet] Generating as of ${toDate}`);

        const report = await db
            .select({
                accountName: glAccounts.name,
                accountType: glAccounts.type,
                debit: sql<number>`COALESCE(sum(${journalEntries.debit}), 0)`,
                credit: sql<number>`COALESCE(sum(${journalEntries.credit}), 0)`,
            })
            .from(journalEntries)
            .innerJoin(journals, eq(journalEntries.journalId, journals.id))
            .innerJoin(
                glAccounts,
                eq(journalEntries.glAccountId, glAccounts.id),
            )
            .where(
                and(
                    eq(journals.status, "posted"),
                    lte(journals.date, toDate),
                    inArray(glAccounts.type, ["asset", "liability", "equity"]),
                ),
            )
            .groupBy(glAccounts.id, glAccounts.name, glAccounts.type);

        const asset = report.filter((r) => r.accountType === "asset");
        const liability = report.filter((r) => r.accountType === "liability");
        const equity = report.filter((r) => r.accountType === "equity");

        // Calculate Net Profit to date to balance the BS
        const plReport = await db
            .select({
                accountType: glAccounts.type,
                debit: sql<number>`COALESCE(sum(${journalEntries.debit}), 0)`,
                credit: sql<number>`COALESCE(sum(${journalEntries.credit}), 0)`,
            })
            .from(journalEntries)
            .innerJoin(journals, eq(journalEntries.journalId, journals.id))
            .innerJoin(
                glAccounts,
                eq(journalEntries.glAccountId, glAccounts.id),
            )
            .where(
                and(
                    eq(journals.status, "posted"),
                    lte(journals.date, toDate),
                    inArray(glAccounts.type, ["income", "expense"]),
                ),
            )
            .groupBy(glAccounts.type);

        const currentProfit = (plReport || []).reduce((sum, r) => {
            if (r.accountType === "income")
                return sum + (Number(r.credit || 0) - Number(r.debit || 0));
            if (r.accountType === "expense")
                return sum - (Number(r.debit || 0) - Number(r.credit || 0));
            return sum;
        }, 0);

        const totalAsset = asset.reduce(
            (sum, r) => sum + (Number(r.debit) - Number(r.credit)),
            0,
        );
        const totalLiability = liability.reduce(
            (sum, r) => sum + (Number(r.credit) - Number(r.debit)),
            0,
        );
        const totalEquity =
            equity.reduce(
                (sum, r) => sum + (Number(r.credit) - Number(r.debit)),
                0,
            ) + currentProfit;

        res.json({
            asset,
            liability,
            equity,
            currentProfit,
            totalAsset,
            totalLiability,
            totalEquity,
        });
    } catch (error: any) {
        console.error("Balance Sheet Error:", error);
        res.status(500).json({
            message: "Failed to generate Balance Sheet",
            error: error.message,
        });
    }
};

export const getProductProfitability = async (req: Request, res: Response) => {
    try {
        const { from, to } = req.query;
        const fromDate = from
            ? (from as string).split("T")[0]
            : new Date(new Date().getFullYear(), 0, 1)
                .toISOString()
                .split("T")[0];
        const toDate = to
            ? (to as string).split("T")[0]
            : new Date().toISOString().split("T")[0];

        const report = await db
            .select({
                productId: products.id,
                productName: products.name,
                totalQty: sql<number>`COALESCE(sum(${transactionDetails.qty}), 0)`,
                totalRevenue: sql<number>`COALESCE(sum(${transactionDetails.amount}), 0)`,
                totalCogs: sql<number>`COALESCE(sum(${transactionDetails.totalCost}), 0)`,
                avgUnitCost: sql<number>`COALESCE(sum(${transactionDetails.totalCost}) / sum(${transactionDetails.qty}), 0)`,
                avgUnitPrice: sql<number>`COALESCE(sum(${transactionDetails.amount}) / sum(${transactionDetails.qty}), 0)`,
            })
            .from(transactionDetails)
            .innerJoin(
                transactions,
                eq(transactionDetails.transactionId, transactions.id),
            )
            .innerJoin(products, eq(transactionDetails.productId, products.id))
            .where(
                and(
                    eq(transactions.type, "sales"),
                    inArray(transactions.status, ["posted", "paid"]),
                    gte(transactions.date, fromDate),
                    lte(transactions.date, toDate),
                ),
            )
            .groupBy(products.id, products.name)
            .orderBy(
                desc(
                    sql`sum(${transactionDetails.amount}) - sum(${transactionDetails.totalCost})`,
                ),
            );

        res.json(report);
    } catch (error: any) {
        console.error("Product Profitability Error:", error);
        res.status(500).json({ message: "Failed to generate report", error: error.message });
    }
};
