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
    productDetails,
    productUnits,
    productAttributes,
    productAttributeValues,
    routeGroups,
    priceGroups,
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
import {
    and,
    eq,
    sql,
    gte,
    lte,
    desc,
    inArray,
    asc,
    ilike,
    or,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { branchScope } from "@/helpers/branch.helper";
import { parseTableQuery } from "@/services/table-query";

const isDocumentStatus = (
    status: string,
): status is "draft" | "posted" | "cancelled" =>
    status === "draft" || status === "posted" || status === "cancelled";

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
            .groupBy(
                glAccounts.id,
                glAccounts.code,
                glAccounts.name,
                glAccounts.type,
            )
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
            .groupBy(
                glAccounts.id,
                glAccounts.code,
                glAccounts.name,
                glAccounts.type,
            )
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
        const totalEquity =
            equity.reduce((sum, r) => sum + r.amount, 0) + currentProfit;

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
            retainedEarningsAccountId:
                globalSettings?.retainedEarningsGlAccountId || null,
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
        const { pageIndex, pageSize, search } = parseTableQuery(req.query);
        const safePageSize =
            Number.isSafeInteger(pageSize) && pageSize > 0
                ? Math.min(pageSize, 100)
                : 10;
        const safePageIndex =
            Number.isSafeInteger(pageIndex) &&
            pageIndex >= 0 &&
            Number.isSafeInteger(pageIndex * safePageSize)
                ? pageIndex
                : 0;
        const safeOffset = safePageIndex * safePageSize;
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

        const conditions = and(
            eq(transactions.type, "sales"),
            inArray(transactions.status, ["posted", "paid"]),
            gte(transactions.date, fromDate),
            lte(transactions.date, toDate),
            searchCondition,
            scope,
        );

        const [rows, [count]] = await Promise.all([
            db
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
                .innerJoin(
                    products,
                    eq(transactionDetails.productId, products.id),
                )
                .where(conditions)
                .groupBy(products.id, products.name)
                .orderBy(
                    desc(
                        sql`sum(${transactionDetails.amount}) - sum(${transactionDetails.totalCost})`,
                    ),
                )
                .limit(safePageSize)
                .offset(safeOffset),
            db
                .select({ count: sql<number>`count(distinct ${products.id})` })
                .from(transactionDetails)
                .innerJoin(
                    transactions,
                    eq(transactionDetails.transactionId, transactions.id),
                )
                .innerJoin(
                    products,
                    eq(transactionDetails.productId, products.id),
                )
                .where(conditions),
        ]);
        const rowCount = Number(count?.count || 0);

        res.json({
            rows,
            rowCount,
            pageCount: Math.ceil(rowCount / safePageSize),
            pageIndex: safePageIndex,
            pageSize: safePageSize,
        });
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
                    contactRoute: routeGroups.name,
                    priceGroupName: priceGroups.name,
                    productId: transactionDetails.productId,
                    productName: products.name,
                    sku: productDetails.skuId,
                    unitName: productUnits.name,
                    warehouseName: warehouses.name,
                    userName: users.displayName,
                    qty: transactionDetails.qty,
                    price: transactionDetails.price,
                    discount: transactionDetails.discount,
                    unitCost: transactionDetails.totalCost
                        ? sql<number>`${transactionDetails.totalCost} / NULLIF(${transactionDetails.qty}, 0)`
                        : transactionDetails.unitCost,
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
                .leftJoin(routeGroups, eq(contacts.routeGroupId, routeGroups.id))
                .leftJoin(priceGroups, eq(contacts.priceGroupId, priceGroups.id))
                .leftJoin(
                    products,
                    eq(transactionDetails.productId, products.id),
                )
                .leftJoin(
                    productDetails,
                    eq(transactionDetails.productDetailId, productDetails.id),
                )
                .leftJoin(
                    productUnits,
                    eq(productDetails.unitId, productUnits.id),
                )
                .leftJoin(
                    warehouses,
                    eq(transactionDetails.warehouseId, warehouses.id),
                )
                .leftJoin(users, eq(transactions.userId, users.id))
                .where(and(...conditions));

            const productIds = Array.from(
                new Set(rawList.map((r) => r.productId).filter(Boolean)),
            ) as string[];

            const categoryMap: Record<string, string> = {};
            if (productIds.length > 0) {
                const attrValues = await db
                    .select({
                        productId: productAttributeValues.productId,
                        attrName: productAttributes.name,
                        value: productAttributeValues.value,
                    })
                    .from(productAttributeValues)
                    .innerJoin(
                        productAttributes,
                        eq(productAttributeValues.attributeId, productAttributes.id),
                    )
                    .where(inArray(productAttributeValues.productId, productIds));
                for (const av of attrValues) {
                    if (av.attrName.toLowerCase() === "category") {
                        categoryMap[av.productId] = av.value;
                    }
                }
            }

            const rows = rawList.map((r) => {
                const dates = formatDateParts(r.date);
                const revenue = Number(r.amount || 0);
                const cogs = Number(r.totalCost || 0);
                const profit = revenue - cogs;
                const taxRate = Number(r.taxRate || 0);
                const taxAmount = Number(((revenue * taxRate) / 100).toFixed(2));
                const amountWithTax = revenue + taxAmount;
                return {
                    ...r,
                    ...dates,
                    contactName: r.contactName || "N/A",
                    contactRoute: r.contactRoute || "No Route",
                    priceGroupName: r.priceGroupName || "N/A",
                    productName: r.productName || "N/A",
                    category: (r.productId && categoryMap[r.productId]) || "N/A",
                    sku: r.sku || "N/A",
                    unitName: r.unitName || "N/A",
                    warehouseName: r.warehouseName || "N/A",
                    userName: r.userName || "N/A",
                    qty: Number(r.qty || 0),
                    price: Number(r.price || 0),
                    discount: Number(r.discount || 0),
                    unitCost: Number(r.unitCost || 0),
                    totalCost: cogs,
                    amount: revenue,
                    profit,
                    taxRate,
                    taxAmount,
                    amountWithTax,
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
                    productId: stocks.productId,
                    productName: products.name,
                    warehouseName: warehouses.name,
                    invoice: transactions.invoice,
                    contactName: contacts.name,
                    contactRoute: routeGroups.name,
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
                .leftJoin(routeGroups, eq(contacts.routeGroupId, routeGroups.id))
                .where(conditions.length ? and(...conditions) : undefined);

            const productIds = Array.from(
                new Set(rawList.map((r) => r.productId).filter(Boolean)),
            ) as string[];

            const categoryMap: Record<string, string> = {};
            if (productIds.length > 0) {
                const attrValues = await db
                    .select({
                        productId: productAttributeValues.productId,
                        attrName: productAttributes.name,
                        value: productAttributeValues.value,
                    })
                    .from(productAttributeValues)
                    .innerJoin(
                        productAttributes,
                        eq(productAttributeValues.attributeId, productAttributes.id),
                    )
                    .where(inArray(productAttributeValues.productId, productIds));
                for (const av of attrValues) {
                    if (av.attrName.toLowerCase() === "category") {
                        categoryMap[av.productId] = av.value;
                    }
                }
            }

            const rows = rawList.map((r) => {
                const dates = formatDateParts(r.createdAt);
                const qty = Number(r.qty || 0);
                const unitCost = Number(r.unitCost || 0);
                const totalCost = Math.abs(qty * unitCost);
                return {
                    ...r,
                    ...dates,
                    productName: r.productName || "N/A",
                    category: (r.productId && categoryMap[r.productId]) || "N/A",
                    warehouseName: r.warehouseName || "N/A",
                    invoice: r.invoice || "N/A",
                    contactName: r.contactName || "N/A",
                    contactRoute: r.contactRoute || "No Route",
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

export const getTransactionRegister = async (req: Request, res: Response) => {
    try {
        const { transactionType, sortBy } = req.params;
        if (
            !["sales", "purchase", "sales-return", "purchase-return"].includes(
                transactionType,
            ) ||
            !["by-salesman", "by-date", "by-invoice", "by-customer"].includes(
                sortBy,
            )
        ) {
            return res.status(400).json({ message: "Invalid report type" });
        }

        const from = typeof req.query.from === "string" ? req.query.from : "";
        const to = typeof req.query.to === "string" ? req.query.to : "";
        const isValidDate = (value: string) =>
            /^\d{4}-\d{2}-\d{2}$/.test(value) &&
            !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) &&
            new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) ===
                value;
        if (!isValidDate(from) || !isValidDate(to)) {
            return res.status(400).json({
                message: "Valid from and to dates are required",
            });
        }
        const fromDate = from;
        const toDate = to;
        const rangeDays =
            (Date.parse(`${toDate}T00:00:00.000Z`) -
                Date.parse(`${fromDate}T00:00:00.000Z`)) /
                86_400_000 +
            1;
        if (rangeDays < 1 || rangeDays > 90) {
            return res.status(400).json({
                message: "Date range must be between 1 and 90 days",
            });
        }

        const transactionTypes =
            transactionType === "sales"
                ? (["sales", "pos_sales"] as const)
                : transactionType === "sales-return"
                  ? (["sales_return"] as const)
                  : transactionType === "purchase-return"
                    ? (["purchase_return"] as const)
                    : (["purchase"] as const);
        const transactionStatuses = transactionType.endsWith("-return")
            ? (["posted"] as const)
            : (["posted", "partial", "paid"] as const);
        const scope = branchScope(transactions.branchId, req);
        const originalTransaction = alias(
            transactions,
            "register_original_transaction",
        );
        const originalContact = alias(contacts, "register_original_contact");
        const originalUser = alias(users, "register_original_user");
        const contactNameExpression = transactionType.endsWith("-return")
            ? sql<string>`COALESCE(${originalContact.name}, ${contacts.name})`
            : contacts.name;
        const userNameExpression = transactionType.endsWith("-return")
            ? sql<string>`COALESCE(${originalUser.displayName}, ${originalUser.username}, ${users.displayName}, ${users.username})`
            : sql<string>`COALESCE(${users.displayName}, ${users.username})`;
        const contactIdExpression = transactionType.endsWith("-return")
            ? sql<
                  string | null
              >`COALESCE(${originalTransaction.contactId}, ${transactions.contactId})`
            : transactions.contactId;
        const userIdExpression = transactionType.endsWith("-return")
            ? sql<string>`COALESCE(${originalTransaction.userId}, ${transactions.userId})`
            : transactions.userId;
        const orderBy =
            sortBy === "by-salesman"
                ? [
                      asc(userNameExpression),
                      asc(transactions.date),
                      asc(transactions.invoice),
                      asc(contacts.name),
                  ]
                : sortBy === "by-invoice"
                  ? [
                        asc(transactions.invoice),
                        asc(transactions.date),
                        asc(contacts.name),
                    ]
                  : sortBy === "by-customer"
                    ? [
                          asc(contactNameExpression),
                          asc(transactions.date),
                          asc(transactions.invoice),
                      ]
                    : [
                          asc(transactions.date),
                          asc(transactions.invoice),
                          asc(contacts.name),
                      ];

        const rows = await db
            .select({
                id: transactions.id,
                invoice: transactions.invoice,
                date: transactions.date,
                contactId: contactIdExpression,
                userId: userIdExpression,
                contactName: contactNameExpression,
                userName: userNameExpression,
                totalAmount: transactions.totalAmount,
            })
            .from(transactions)
            .leftJoin(contacts, eq(transactions.contactId, contacts.id))
            .leftJoin(users, eq(transactions.userId, users.id))
            .leftJoin(
                originalTransaction,
                eq(transactions.parentId, originalTransaction.id),
            )
            .leftJoin(
                originalContact,
                eq(originalTransaction.contactId, originalContact.id),
            )
            .leftJoin(
                originalUser,
                eq(originalTransaction.userId, originalUser.id),
            )
            .where(
                and(
                    inArray(transactions.type, transactionTypes),
                    inArray(transactions.status, transactionStatuses),
                    gte(transactions.date, fromDate),
                    lte(transactions.date, toDate),
                    scope,
                ),
            )
            .orderBy(...orderBy);

        const normalizedRows = rows.map((row) => ({
            ...row,
            date: String(row.date),
            contactName: row.contactName || "-",
            userName: row.userName || "-",
            totalAmount: Number(row.totalAmount || 0),
        }));
        const reportRows =
            sortBy === "by-invoice"
                ? normalizedRows.map(({ contactId, userId, ...row }) => ({
                      ...row,
                      transactionCount: 1,
                  }))
                : Array.from(
                      normalizedRows.reduce((groups, row) => {
                          const groupKey =
                              sortBy === "by-date"
                                  ? row.date
                                  : sortBy === "by-customer"
                                    ? (row.contactId ??
                                      `name:${row.contactName}`)
                                    : row.userId;
                          const group = groups.get(groupKey) ?? {
                              id: `${sortBy}-${groups.size}`,
                              date: sortBy === "by-date" ? row.date : undefined,
                              contactName:
                                  sortBy === "by-customer"
                                      ? row.contactName
                                      : undefined,
                              userName:
                                  sortBy === "by-salesman"
                                      ? row.userName
                                      : undefined,
                              transactionCount: 0,
                              totalAmount: 0,
                          };
                          group.transactionCount += 1;
                          group.totalAmount = Number(
                              (group.totalAmount + row.totalAmount).toFixed(2),
                          );
                          groups.set(groupKey, group);
                          return groups;
                      }, new Map()),
                  ).map(([, group]) => group);

        return res.json({
            fromDate,
            toDate,
            rows: reportRows,
            totalAmount: reportRows.reduce(
                (total, row) => total + row.totalAmount,
                0,
            ),
        });
    } catch (error) {
        console.error("Transaction Register Error:", error);
        return res.status(500).json({ message: "Failed to generate report" });
    }
};
