import { Request, Response } from "express";
import { db } from "@/db";
import {
    contacts,
    glAccounts,
    journalEntries,
    journals,
    openInvoices,
    periodClosings,
    products,
    settings,
    stockMovements,
    stocks,
    transactionDetails,
    transactions,
    users,
    warehouses,
    expenses,
    incomes,
    stockOpnames,
    payments,
    branches,
} from "@/db/schemas";
import { and, eq, sql, gte, lte, desc, inArray, asc, ilike, or } from "drizzle-orm";
import { branchScope } from "@/helpers/branch.helper";

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

        const scope = branchScope(journals.branchId, req);

        const globalSettings = await db.query.settings.findFirst({
            where: eq(settings.id, "global"),
        });

        const closingDate = globalSettings?.closingDate || null;
        let periodStatus: "closed" | "open" | "partial" = "open";
        if (closingDate) {
            if (toDate <= closingDate) {
                periodStatus = "closed";
            } else if (fromDate <= closingDate && toDate > closingDate) {
                periodStatus = "partial";
            }
        }

        const report = await db
            .select({
                accountId: glAccounts.id,
                accountCode: glAccounts.code,
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
                    sql`${journals.id} NOT IN (SELECT closing_journal_id FROM period_closings WHERE closing_journal_id IS NOT NULL AND status = 'closed')`,
                    scope,
                ),
            )
            .groupBy(glAccounts.id, glAccounts.code, glAccounts.name, glAccounts.type)
            .orderBy(asc(glAccounts.code));

        const income = report
            .filter((r) => r.accountType === "income")
            .map((r) => ({
                ...r,
                amount: Number(r.credit || 0) - Number(r.debit || 0),
            }));

        const expense = report
            .filter((r) => r.accountType === "expense")
            .map((r) => ({
                ...r,
                amount: Number(r.debit || 0) - Number(r.credit || 0),
            }));

        const totalIncome = income.reduce((sum, r) => sum + r.amount, 0);
        const totalExpense = expense.reduce((sum, r) => sum + r.amount, 0);
        const netProfit = totalIncome - totalExpense;

        res.json({
            fromDate,
            toDate,
            branchId: req.activeBranchId || (req.user as any)?.branchId || null,
            income,
            expense,
            totalIncome,
            totalExpense,
            netProfit,
            closingDate,
            periodStatus,
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

        const scope = branchScope(journals.branchId, req);

        const report = await db
            .select({
                accountId: glAccounts.id,
                accountCode: glAccounts.code,
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
                    scope,
                ),
            )
            .groupBy(glAccounts.id, glAccounts.code, glAccounts.name, glAccounts.type)
            .orderBy(asc(glAccounts.code));

        const asset = report
            .filter((r) => r.accountType === "asset")
            .map((r) => ({
                ...r,
                amount: Number(r.debit) - Number(r.credit),
            }));

        const liability = report
            .filter((r) => r.accountType === "liability")
            .map((r) => ({
                ...r,
                amount: Number(r.credit) - Number(r.debit),
            }));

        const equity = report
            .filter((r) => r.accountType === "equity")
            .map((r) => ({
                ...r,
                amount: Number(r.credit) - Number(r.debit),
            }));

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
                    scope,
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

        const totalAsset = asset.reduce((sum, r) => sum + r.amount, 0);
        const totalLiability = liability.reduce((sum, r) => sum + r.amount, 0);
        const totalEquity = equity.reduce((sum, r) => sum + r.amount, 0) + currentProfit;

        const discrepancy = totalAsset - (totalLiability + totalEquity);
        const isBalanced = Math.abs(discrepancy) < 0.01;

        const globalSettings = await db.query.settings.findFirst({
            where: eq(settings.id, "global"),
        });

        res.json({
            asOfDate: toDate,
            branchId: req.activeBranchId || (req.user as any)?.branchId || null,
            asset,
            liability,
            equity,
            currentProfit,
            totalAsset,
            totalLiability,
            totalEquity,
            isBalanced,
            discrepancy,
            lastClosingDate: globalSettings?.closingDate || null,
            retainedEarningsAccountId: globalSettings?.retainedEarningsGlAccountId || null,
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
        const { from, to, search } = req.query;
        const fromDate = from
            ? (from as string).split("T")[0]
            : new Date(new Date().getFullYear(), 0, 1)
                  .toISOString()
                  .split("T")[0];
        const toDate = to
            ? (to as string).split("T")[0]
            : new Date().toISOString().split("T")[0];

        const scope = branchScope(transactions.branchId, req);
        const searchCondition = search
            ? ilike(products.name, `%${search}%`)
            : undefined;

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
                    searchCondition,
                    scope,
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

        const scope = branchScope(journals.branchId, req);

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
                    scope,
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

        const scope = branchScope(openInvoices.branchId, req);

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
                    scope,
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
            const txScope = branchScope(transactions.branchId, req);
            const conditions = [eq(transactions.type, txType)];
            if (txScope) conditions.push(txScope);
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
                    unitCost: transactionDetails.totalCost ? sql<number>`${transactionDetails.totalCost} / NULLIF(${transactionDetails.qty}, 0)` : transactionDetails.unitCost,
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
            const whScope = branchScope(warehouses.branchId, req);
            const conditions = [];
            if (whScope) conditions.push(whScope);
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
            const jScope = branchScope(journals.branchId, req);
            const conditions = [eq(journals.status, "posted")];
            if (jScope) conditions.push(jScope);
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

/* ─────────────────── GET /reports/transaction-summary ─────────────────── */

export const getTransactionSummary = async (req: Request, res: Response) => {
    try {
        const {
            type = "sales",
            from,
            to,
            status,
            contactId,
            userId,
            search = "",
        } = req.query as Record<string, string>;

        const fromDate = from ? (from as string).split("T")[0] : undefined;
        const toDate = to ? (to as string).split("T")[0] : undefined;

        let rows: Array<{
            id: string;
            date: string;
            code: string;
            reference?: string | null;
            note?: string | null;
            status: string;
            contactId?: string | null;
            contactName?: string | null;
            userId?: string | null;
            userName?: string | null;
            branchName?: string | null;
            warehouseName?: string | null;
            subtotal?: number;
            discount?: number;
            tax?: number;
            amount: number;
            paidAmount?: number;
            remainingAmount?: number;
        }> = [];

        // 1. Core transactions (sales, purchase, sales_return, purchase_return, transfer_stock, adjustment)
        if (
            [
                "sales",
                "purchase",
                "sales_return",
                "purchase_return",
                "transfer_stock",
                "adjustment",
            ].includes(type)
        ) {
            const scope = branchScope(transactions.branchId, req);
            const conditions = [
                eq(transactions.type, type as any),
                scope,
                status ? eq(transactions.status, status as any) : undefined,
                fromDate ? gte(transactions.date, fromDate) : undefined,
                toDate ? lte(transactions.date, toDate) : undefined,
                contactId ? eq(transactions.contactId, contactId) : undefined,
                userId ? eq(transactions.userId, userId) : undefined,
                search
                    ? or(
                          ilike(transactions.invoice, `%${search}%`),
                          ilike(contacts.name, `%${search}%`),
                          ilike(transactions.reference, `%${search}%`),
                      )
                    : undefined,
            ];

            const raw = await db
                .select({
                    id: transactions.id,
                    date: transactions.date,
                    code: transactions.invoice,
                    reference: transactions.reference,
                    note: transactions.note,
                    status: transactions.status,
                    contactId: transactions.contactId,
                    contactName: contacts.name,
                    userId: transactions.userId,
                    userName: users.displayName,
                    usernameFallback: users.username,
                    branchName: branches.name,
                    subtotal: transactions.subtotal,
                    discount: transactions.totalDiscount,
                    tax: transactions.totalTax,
                    amount: transactions.totalAmount,
                })
                .from(transactions)
                .leftJoin(contacts, eq(transactions.contactId, contacts.id))
                .leftJoin(users, eq(transactions.userId, users.id))
                .leftJoin(branches, eq(transactions.branchId, branches.id))
                .where(and(...conditions))
                .orderBy(desc(transactions.date), desc(transactions.createdAt));

            rows = raw.map((r) => ({
                id: r.id,
                date: String(r.date),
                code: r.code,
                reference: r.reference,
                note: r.note,
                status: r.status,
                contactId: r.contactId,
                contactName: r.contactName || "-",
                userId: r.userId,
                userName: r.userName || r.usernameFallback || "-",
                branchName: r.branchName || "-",
                subtotal: Number(r.subtotal || 0),
                discount: Number(r.discount || 0),
                tax: Number(r.tax || 0),
                amount: Number(r.amount || 0),
            }));
        }
        // 2. Expenses
        else if (type === "expense") {
            const scope = branchScope(expenses.branchId, req);
            const conditions = [
                scope,
                status ? eq(expenses.status, status) : undefined,
                fromDate ? gte(expenses.date, fromDate) : undefined,
                toDate ? lte(expenses.date, toDate) : undefined,
                userId ? eq(expenses.userId, userId) : undefined,
                search
                    ? or(
                          ilike(expenses.code, `%${search}%`),
                          ilike(expenses.description, `%${search}%`),
                          ilike(expenses.reference, `%${search}%`),
                      )
                    : undefined,
            ];

            const raw = await db
                .select({
                    id: expenses.id,
                    date: expenses.date,
                    code: expenses.code,
                    reference: expenses.reference,
                    note: expenses.description,
                    status: expenses.status,
                    userId: expenses.userId,
                    userName: users.displayName,
                    usernameFallback: users.username,
                    branchName: branches.name,
                    amount: expenses.totalAmount,
                })
                .from(expenses)
                .leftJoin(users, eq(expenses.userId, users.id))
                .leftJoin(branches, eq(expenses.branchId, branches.id))
                .where(and(...conditions))
                .orderBy(desc(expenses.date), desc(expenses.createdAt));

            rows = raw.map((r) => ({
                id: r.id,
                date: String(r.date),
                code: r.code,
                reference: r.reference,
                note: r.note,
                status: r.status,
                userId: r.userId,
                userName: r.userName || r.usernameFallback || "-",
                branchName: r.branchName || "-",
                amount: Number(r.amount || 0),
            }));
        }
        // 3. Incomes
        else if (type === "income") {
            const scope = branchScope(incomes.branchId, req);
            const conditions = [
                scope,
                status ? eq(incomes.status, status) : undefined,
                fromDate ? gte(incomes.date, fromDate) : undefined,
                toDate ? lte(incomes.date, toDate) : undefined,
                userId ? eq(incomes.userId, userId) : undefined,
                search
                    ? or(
                          ilike(incomes.code, `%${search}%`),
                          ilike(incomes.description, `%${search}%`),
                          ilike(incomes.reference, `%${search}%`),
                      )
                    : undefined,
            ];

            const raw = await db
                .select({
                    id: incomes.id,
                    date: incomes.date,
                    code: incomes.code,
                    reference: incomes.reference,
                    note: incomes.description,
                    status: incomes.status,
                    userId: incomes.userId,
                    userName: users.displayName,
                    usernameFallback: users.username,
                    branchName: branches.name,
                    amount: incomes.totalAmount,
                })
                .from(incomes)
                .leftJoin(users, eq(incomes.userId, users.id))
                .leftJoin(branches, eq(incomes.branchId, branches.id))
                .where(and(...conditions))
                .orderBy(desc(incomes.date), desc(incomes.createdAt));

            rows = raw.map((r) => ({
                id: r.id,
                date: String(r.date),
                code: r.code,
                reference: r.reference,
                note: r.note,
                status: r.status,
                userId: r.userId,
                userName: r.userName || r.usernameFallback || "-",
                branchName: r.branchName || "-",
                amount: Number(r.amount || 0),
            }));
        }
        // 4. Receivables / Payables (Open Invoices & Aging)
        else if (type === "receivable" || type === "payable") {
            const scope = branchScope(openInvoices.branchId, req);
            const conditions = [
                eq(openInvoices.type, type),
                scope,
                status ? eq(openInvoices.status, status as any) : undefined,
                fromDate ? gte(openInvoices.dueDate, fromDate) : undefined,
                toDate ? lte(openInvoices.dueDate, toDate) : undefined,
                contactId ? eq(openInvoices.contactId, contactId) : undefined,
                search
                    ? or(
                          ilike(transactions.invoice, `%${search}%`),
                          ilike(contacts.name, `%${search}%`),
                      )
                    : undefined,
            ];

            const raw = await db
                .select({
                    id: openInvoices.id,
                    date: openInvoices.dueDate,
                    code: transactions.invoice,
                    reference: transactions.reference,
                    note: transactions.note,
                    status: openInvoices.status,
                    contactId: openInvoices.contactId,
                    contactName: contacts.name,
                    branchName: branches.name,
                    amount: openInvoices.amount,
                    paidAmount: openInvoices.paidAmount,
                })
                .from(openInvoices)
                .leftJoin(transactions, eq(openInvoices.transactionId, transactions.id))
                .leftJoin(contacts, eq(openInvoices.contactId, contacts.id))
                .leftJoin(branches, eq(openInvoices.branchId, branches.id))
                .where(and(...conditions))
                .orderBy(asc(openInvoices.dueDate));

            rows = raw.map((r) => {
                const amt = Number(r.amount || 0);
                const paid = Number(r.paidAmount || 0);
                return {
                    id: r.id,
                    date: String(r.date),
                    code: r.code || "-",
                    reference: r.reference,
                    note: r.note,
                    status: r.status,
                    contactId: r.contactId,
                    contactName: r.contactName || "-",
                    branchName: r.branchName || "-",
                    amount: amt,
                    paidAmount: paid,
                    remainingAmount: amt - paid,
                };
            });
        }
        // 5. Journals
        else if (type === "journal") {
            const scope = branchScope(journals.branchId, req);
            const conditions = [
                scope,
                status ? eq(journals.status, status as any) : undefined,
                fromDate ? gte(journals.date, fromDate) : undefined,
                toDate ? lte(journals.date, toDate) : undefined,
                search
                    ? or(
                          ilike(journals.invoice, `%${search}%`),
                          ilike(journals.description, `%${search}%`),
                      )
                    : undefined,
            ];

            const raw = await db
                .select({
                    id: journals.id,
                    date: journals.date,
                    code: journals.invoice,
                    note: journals.description,
                    status: journals.status,
                    branchName: branches.name,
                    totalDebit: sql<number>`coalesce(sum(${journalEntries.debit}), 0)`,
                })
                .from(journals)
                .leftJoin(journalEntries, eq(journals.id, journalEntries.journalId))
                .leftJoin(branches, eq(journals.branchId, branches.id))
                .where(and(...conditions))
                .groupBy(journals.id, branches.name)
                .orderBy(desc(journals.date), desc(journals.createdAt));

            rows = raw.map((r) => ({
                id: r.id,
                date: String(r.date),
                code: r.code,
                note: r.note,
                status: r.status,
                branchName: r.branchName || "-",
                amount: Number(r.totalDebit || 0),
            }));
        }
        // 6. Stock Opnames
        else if (type === "stock_opname") {
            const scope = branchScope(stockOpnames.branchId, req);
            const conditions = [
                scope,
                status ? eq(stockOpnames.status, status as any) : undefined,
                fromDate ? gte(stockOpnames.countDate, fromDate) : undefined,
                toDate ? lte(stockOpnames.countDate, toDate) : undefined,
                search
                    ? or(
                          ilike(stockOpnames.code, `%${search}%`),
                          ilike(stockOpnames.name, `%${search}%`),
                      )
                    : undefined,
            ];

            const raw = await db
                .select({
                    id: stockOpnames.id,
                    date: stockOpnames.countDate,
                    code: stockOpnames.code,
                    note: stockOpnames.note,
                    status: stockOpnames.status,
                    warehouseName: warehouses.name,
                    userName: users.displayName,
                    usernameFallback: users.username,
                    branchName: branches.name,
                })
                .from(stockOpnames)
                .leftJoin(warehouses, eq(stockOpnames.warehouseId, warehouses.id))
                .leftJoin(users, eq(stockOpnames.createdBy, users.id))
                .leftJoin(branches, eq(stockOpnames.branchId, branches.id))
                .where(and(...conditions))
                .orderBy(desc(stockOpnames.countDate), desc(stockOpnames.createdAt));

            rows = raw.map((r) => ({
                id: r.id,
                date: String(r.date),
                code: r.code,
                note: r.note,
                status: r.status,
                warehouseName: r.warehouseName || "Semua Gudang",
                userName: r.userName || r.usernameFallback || "-",
                branchName: r.branchName || "-",
                amount: 0,
            }));
        }

        // Summary Aggregations
        const totalCount = rows.length;
        const totalAmount = rows.reduce((s, r) => s + (r.amount || 0), 0);
        const totalSubtotal = rows.reduce((s, r) => s + (r.subtotal || 0), 0);
        const totalDiscount = rows.reduce((s, r) => s + (r.discount || 0), 0);
        const totalTax = rows.reduce((s, r) => s + (r.tax || 0), 0);
        const totalPaid = rows.reduce((s, r) => s + (r.paidAmount || 0), 0);
        const totalRemaining = rows.reduce((s, r) => s + (r.remainingAmount || 0), 0);

        // Grouped By Contact
        const contactMap = new Map<string, { contactName: string; count: number; totalAmount: number }>();
        rows.forEach((r) => {
            const name = r.contactName || "Lainnya / Umum";
            const existing = contactMap.get(name) || { contactName: name, count: 0, totalAmount: 0 };
            existing.count += 1;
            existing.totalAmount += r.amount;
            contactMap.set(name, existing);
        });
        const groupedByContact = Array.from(contactMap.values()).sort((a, b) => b.totalAmount - a.totalAmount);

        // Grouped By User
        const userMap = new Map<string, { userName: string; count: number; totalAmount: number }>();
        rows.forEach((r) => {
            const name = r.userName || "Sistem";
            const existing = userMap.get(name) || { userName: name, count: 0, totalAmount: 0 };
            existing.count += 1;
            existing.totalAmount += r.amount;
            userMap.set(name, existing);
        });
        const groupedByUser = Array.from(userMap.values()).sort((a, b) => b.totalAmount - a.totalAmount);

        return res.json({
            type,
            summary: {
                totalCount,
                totalAmount,
                totalSubtotal,
                totalDiscount,
                totalTax,
                totalPaid,
                totalRemaining,
            },
            groupedByContact,
            groupedByUser,
            rows,
        });
    } catch (err: any) {
        console.error("[getTransactionSummary]", err);
        return res.status(500).json({ message: "Failed to generate transaction summary", error: err.message });
    }
};
