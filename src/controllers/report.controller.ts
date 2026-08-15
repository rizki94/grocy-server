import { Request, Response } from "express";
import { db } from "@/db";
import {
    contacts,
    glAccounts,
    journalEntries,
    journals,
    openInvoices,
    products,
    stockMovements,
    stocks,
    transactionDetails,
    transactions,
    users,
    warehouses,
} from "@/db/schemas";
import { and, eq, sql, gte, lte, desc, inArray, asc } from "drizzle-orm";

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
        const toDate =
            (typeof date === "string" ? date : String(date || "")).split(
                "T",
            )[0] || new Date().toISOString().split("T")[0];

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
        res.status(500).json({
            message: "Failed to generate report",
            error: error.message,
        });
    }
};

export const getGlBalances = async (req: Request, res: Response) => {
    try {
        const { from, to } = req.query;
        let dateCondition = undefined;

        if (from && to) {
            const fromDate = (from as string).split("T")[0];
            const toDate = (to as string).split("T")[0];
            dateCondition = and(
                gte(sql`DATE(${journals.date})`, fromDate),
                lte(sql`DATE(${journals.date})`, toDate),
            );
        } else {
            // Default to current month if no dates provided
            const fromDate = new Date(
                new Date().getFullYear(),
                new Date().getMonth(),
                1,
            )
                .toISOString()
                .split("T")[0];
            const toDate = new Date().toISOString().split("T")[0];
            dateCondition = and(
                gte(sql`DATE(${journals.date})`, fromDate),
                lte(sql`DATE(${journals.date})`, toDate),
            );
        }

        const report = await db
            .select({
                id: glAccounts.id,
                code: glAccounts.code,
                name: glAccounts.name,
                type: glAccounts.type,
                isActive: glAccounts.isActive,
                debit: sql<number>`COALESCE(sum(${journalEntries.debit}), 0)`,
                credit: sql<number>`COALESCE(sum(${journalEntries.credit}), 0)`,
            })
            .from(glAccounts)
            .leftJoin(
                journalEntries,
                eq(journalEntries.glAccountId, glAccounts.id),
            )
            .leftJoin(
                journals,
                and(
                    eq(journalEntries.journalId, journals.id),
                    eq(journals.status, "posted"),
                    dateCondition,
                ),
            )
            .groupBy(
                glAccounts.id,
                glAccounts.code,
                glAccounts.name,
                glAccounts.type,
                glAccounts.isActive,
            )
            .orderBy(asc(glAccounts.code));

        res.status(200).json(report);
    } catch (error) {
        console.error("Error generating GL Balances:", error);
        res.status(500).json({ message: "Failed to generate report" });
    }
};

export const getCustomerOutstandingAr = async (req: Request, res: Response) => {
    try {
        const { to } = req.query;
        const toDate = to
            ? (to as string).split("T")[0]
            : new Date().toISOString().split("T")[0];

        const report = await db
            .select({
                customerId: contacts.id,
                customerName: contacts.name,
                totalAmount: sql<number>`COALESCE(sum(${openInvoices.amount}), 0)`,
                paidAmount: sql<number>`COALESCE(sum(${openInvoices.paidAmount}), 0)`,
                remainingAmount: sql<number>`COALESCE(sum(${openInvoices.amount} - ${openInvoices.paidAmount}), 0)`,
            })
            .from(contacts)
            .innerJoin(openInvoices, eq(contacts.id, openInvoices.contactId))
            .where(
                and(
                    eq(openInvoices.type, "receivable"),
                    lte(openInvoices.dueDate, toDate),
                    sql`${openInvoices.amount} - ${openInvoices.paidAmount} > 0`,
                ),
            )
            .groupBy(contacts.id, contacts.name)
            .orderBy(
                desc(
                    sql`sum(${openInvoices.amount} - ${openInvoices.paidAmount})`,
                ),
            );

        res.json(report);
    } catch (error: any) {
        console.error("Customer Outstanding AR Error:", error);
        res.status(500).json({
            message: "Failed to generate report",
            error: error.message,
        });
    }
};

export const getPivotData = async (req: Request, res: Response) => {
    try {
        const { source, from, to } = req.query;
        const sourceType = (source as string) || "sales";

        const fromDate = from ? (from as string).split("T")[0] : undefined;
        const toDate = to ? (to as string).split("T")[0] : undefined;

        const formatDateParts = (dateInput: any) => {
            if (!dateInput)
                return {
                    dateStr: "",
                    year: "",
                    quarter: "",
                    month: "",
                    dayOfWeek: "",
                };
            const d = new Date(dateInput);
            if (isNaN(d.getTime()))
                return {
                    dateStr: String(dateInput),
                    year: "",
                    quarter: "",
                    month: "",
                    dayOfWeek: "",
                };
            const year = d.getFullYear().toString();
            const monthNum = String(d.getMonth() + 1).padStart(2, "0");
            const month = `${year}-${monthNum}`;
            const q = Math.floor(d.getMonth() / 3) + 1;
            const quarter = `${year}-Q${q}`;
            const days = [
                "Sunday",
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday",
            ];
            const dayOfWeek = days[d.getDay()] || "";
            const dateStr = `${year}-${monthNum}-${String(d.getDate()).padStart(2, "0")}`;
            return { dateStr, year, quarter, month, dayOfWeek };
        };

        if (sourceType === "sales" || sourceType === "purchases") {
            const txType = sourceType === "sales" ? "sales" : "purchase";
            const conditions = [eq(transactions.type, txType)];
            if (fromDate)
                conditions.push(gte(sql`DATE(${transactions.date})`, fromDate));
            if (toDate)
                conditions.push(lte(sql`DATE(${transactions.date})`, toDate));

            const rawList = await db
                .select({
                    id: transactionDetails.id,
                    transactionId: transactions.id,
                    invoice: transactions.invoice,
                    date: transactions.date,
                    status: transactions.status,
                    contactName: contacts.name,
                    productName: products.name,
                    warehouseName: warehouses.name,
                    userName: users.displayName,
                    qty: transactionDetails.qty,
                    price: transactionDetails.price,
                    discount: transactionDetails.discount,
                    unitCost: transactionDetails.unitCost,
                    totalCost: transactionDetails.totalCost,
                    amount: transactionDetails.amount,
                    taxRate: transactionDetails.taxRate,
                })
                .from(transactionDetails)
                .innerJoin(
                    transactions,
                    eq(transactionDetails.transactionId, transactions.id),
                )
                .leftJoin(contacts, eq(transactions.contactId, contacts.id))
                .leftJoin(
                    products,
                    eq(transactionDetails.productId, products.id),
                )
                .leftJoin(
                    warehouses,
                    eq(transactionDetails.warehouseId, warehouses.id),
                )
                .leftJoin(users, eq(transactions.userId, users.id))
                .where(and(...conditions));

            const rows = rawList.map((r) => {
                const dates = formatDateParts(r.date);
                const revenue = Number(r.amount || 0);
                const cogs = Number(r.totalCost || 0);
                const profit = revenue - cogs;
                return {
                    ...r,
                    ...dates,
                    contactName: r.contactName || "N/A",
                    productName: r.productName || "N/A",
                    warehouseName: r.warehouseName || "N/A",
                    userName: r.userName || "N/A",
                    qty: Number(r.qty || 0),
                    price: Number(r.price || 0),
                    discount: Number(r.discount || 0),
                    unitCost: Number(r.unitCost || 0),
                    totalCost: cogs,
                    amount: revenue,
                    profit,
                    taxRate: Number(r.taxRate || 0),
                };
            });

            return res.json({ source: sourceType, count: rows.length, rows });
        }

        if (sourceType === "stock_movements") {
            const conditions = [];
            if (fromDate)
                conditions.push(
                    gte(sql`DATE(${stockMovements.createdAt})`, fromDate),
                );
            if (toDate)
                conditions.push(
                    lte(sql`DATE(${stockMovements.createdAt})`, toDate),
                );

            const rawList = await db
                .select({
                    id: stockMovements.id,
                    createdAt: stockMovements.createdAt,
                    type: stockMovements.type,
                    qty: stockMovements.qty,
                    unitCost: stockMovements.unitCost,
                    batchNumber: stockMovements.batchNumber,
                    expiryDate: stockMovements.expiryDate,
                    note: stockMovements.note,
                    productName: products.name,
                    warehouseName: warehouses.name,
                    invoice: transactions.invoice,
                    contactName: contacts.name,
                })
                .from(stockMovements)
                .innerJoin(stocks, eq(stockMovements.stockId, stocks.id))
                .innerJoin(products, eq(stocks.productId, products.id))
                .leftJoin(warehouses, eq(stocks.warehouseId, warehouses.id))
                .leftJoin(
                    transactions,
                    eq(stockMovements.transactionId, transactions.id),
                )
                .leftJoin(contacts, eq(transactions.contactId, contacts.id))
                .where(conditions.length ? and(...conditions) : undefined);

            const rows = rawList.map((r) => {
                const dates = formatDateParts(r.createdAt);
                const qty = Number(r.qty || 0);
                const unitCost = Number(r.unitCost || 0);
                const totalCost = Math.abs(qty * unitCost);
                return {
                    ...r,
                    ...dates,
                    productName: r.productName || "N/A",
                    warehouseName: r.warehouseName || "N/A",
                    invoice: r.invoice || "N/A",
                    contactName: r.contactName || "N/A",
                    qty,
                    unitCost,
                    totalCost,
                };
            });

            return res.json({ source: sourceType, count: rows.length, rows });
        }

        if (sourceType === "journals") {
            const conditions = [eq(journals.status, "posted")];
            if (fromDate)
                conditions.push(gte(sql`DATE(${journals.date})`, fromDate));
            if (toDate)
                conditions.push(lte(sql`DATE(${journals.date})`, toDate));

            const rawList = await db
                .select({
                    id: journalEntries.id,
                    journalId: journals.id,
                    journalDate: journals.date,
                    description: journals.description,
                    accountCode: glAccounts.code,
                    accountName: glAccounts.name,
                    accountType: glAccounts.type,
                    debit: journalEntries.debit,
                    credit: journalEntries.credit,
                    memo: journalEntries.note,
                })
                .from(journalEntries)
                .innerJoin(journals, eq(journalEntries.journalId, journals.id))
                .innerJoin(
                    glAccounts,
                    eq(journalEntries.glAccountId, glAccounts.id),
                )
                .where(and(...conditions));

            const rows = rawList.map((r) => {
                const dates = formatDateParts(r.journalDate);
                const debit = Number(r.debit || 0);
                const credit = Number(r.credit || 0);
                const netAmount = debit - credit;
                return {
                    ...r,
                    ...dates,
                    accountCode: r.accountCode || "",
                    accountName: r.accountName || "",
                    accountType: r.accountType || "",
                    debit,
                    credit,
                    netAmount,
                };
            });

            return res.json({ source: sourceType, count: rows.length, rows });
        }

        return res.status(400).json({ message: "Invalid source parameter" });
    } catch (error: any) {
        console.error("Pivot Data Error:", error);
        res.status(500).json({
            message: "Failed to fetch pivot data",
            error: error.message,
        });
    }
};
