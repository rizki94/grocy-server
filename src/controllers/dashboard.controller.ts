import { db } from "@/db";
import {
    transactions,
    transactionDetails,
    contacts,
    stocks,
    openInvoices,
    products,
    warehouses,
    productDetails,
    productUnits,
} from "@/db/schemas";
import { and, eq, gte, sql, desc, inArray, lt, ne } from "drizzle-orm";
import { Request, Response } from "express";
import { branchScope, productBranchFilter } from "@/helpers/branch.helper";

export const getDashboardStats = async (req: Request, res: Response) => {
    try {
        const today = new Date();
        const todayStr = today.toISOString().split("T")[0];
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split("T")[0];
        const startOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString().split("T")[0];
        const endOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0).toISOString().split("T")[0];

        // 1. Sales Today (Net: Sales + POS - Returns)
        const [salesToday] = await db
            .select({
                count: sql<number>`count(*)`,
                total: sql<number>`COALESCE(SUM(
                    CASE 
                        WHEN ${transactions.type} IN ('sales', 'pos_sales') THEN ${transactions.totalAmount}
                        WHEN ${transactions.type} = 'sales_return' THEN -${transactions.totalAmount}
                        ELSE 0 
                    END
                ), 0)`,
            })
            .from(transactions)
            .where(
                and(
                    sql`${transactions.type} IN ('sales', 'pos_sales', 'sales_return')`,
                    eq(transactions.status, "posted"),
                    eq(transactions.date, todayStr),
                    branchScope(transactions.branchId, req),
                ),
            );

        // 2. Sales This Month
        const [salesThisMonth] = await db
            .select({
                count: sql<number>`count(*)`,
                total: sql<number>`COALESCE(SUM(
                    CASE 
                        WHEN ${transactions.type} IN ('sales', 'pos_sales') THEN ${transactions.totalAmount}
                        WHEN ${transactions.type} = 'sales_return' THEN -${transactions.totalAmount}
                        ELSE 0 
                    END
                ), 0)`,
            })
            .from(transactions)
            .where(
                and(
                    sql`${transactions.type} IN ('sales', 'pos_sales', 'sales_return')`,
                    eq(transactions.status, "posted"),
                    gte(transactions.date, startOfMonth),
                    branchScope(transactions.branchId, req),
                ),
            );

        // 3. Sales Last Month
        const [salesLastMonth] = await db
            .select({
                total: sql<number>`COALESCE(SUM(
                    CASE 
                        WHEN ${transactions.type} IN ('sales', 'pos_sales') THEN ${transactions.totalAmount}
                        WHEN ${transactions.type} = 'sales_return' THEN -${transactions.totalAmount}
                        ELSE 0 
                    END
                ), 0)`,
            })
            .from(transactions)
            .where(
                and(
                    sql`${transactions.type} IN ('sales', 'pos_sales', 'sales_return')`,
                    eq(transactions.status, "posted"),
                    gte(transactions.date, startOfLastMonth),
                    sql`${transactions.date} <= ${endOfLastMonth}`,
                    branchScope(transactions.branchId, req),
                ),
            );

        // 4. Purchases This Month
        const [purchasesThisMonth] = await db
            .select({
                count: sql<number>`count(*)`,
                total: sql<number>`COALESCE(SUM(
                    CASE 
                        WHEN ${transactions.type} = 'purchase' THEN ${transactions.totalAmount}
                        WHEN ${transactions.type} = 'purchase_return' THEN -${transactions.totalAmount}
                        ELSE 0 
                    END
                ), 0)`,
            })
            .from(transactions)
            .where(
                and(
                    sql`${transactions.type} IN ('purchase', 'purchase_return')`,
                    eq(transactions.status, "posted"),
                    gte(transactions.date, startOfMonth),
                    branchScope(transactions.branchId, req),
                ),
            );

        // 5. Receivables (Total + Overdue breakdown)
        const [receivables] = await db
            .select({
                count: sql<number>`count(*)`,
                total: sql<number>`COALESCE(sum(${openInvoices.amount} - ${openInvoices.paidAmount}), 0)`,
            })
            .from(openInvoices)
            .where(
                and(
                    eq(openInvoices.type, "receivable"),
                    sql`${openInvoices.status} IN ('open', 'partial')`,
                    branchScope(openInvoices.branchId, req),
                ),
            );

        const [overdueReceivables] = await db
            .select({
                count: sql<number>`count(*)`,
                total: sql<number>`COALESCE(sum(${openInvoices.amount} - ${openInvoices.paidAmount}), 0)`,
            })
            .from(openInvoices)
            .where(
                and(
                    eq(openInvoices.type, "receivable"),
                    sql`${openInvoices.status} IN ('open', 'partial')`,
                    sql`${openInvoices.dueDate} < ${todayStr}`,
                    branchScope(openInvoices.branchId, req),
                ),
            );

        // 6. Payables (Total + Overdue breakdown)
        const [payables] = await db
            .select({
                count: sql<number>`count(*)`,
                total: sql<number>`COALESCE(sum(${openInvoices.amount} - ${openInvoices.paidAmount}), 0)`,
            })
            .from(openInvoices)
            .where(
                and(
                    eq(openInvoices.type, "payable"),
                    sql`${openInvoices.status} IN ('open', 'partial')`,
                    branchScope(openInvoices.branchId, req),
                ),
            );

        const [overduePayables] = await db
            .select({
                count: sql<number>`count(*)`,
                total: sql<number>`COALESCE(sum(${openInvoices.amount} - ${openInvoices.paidAmount}), 0)`,
            })
            .from(openInvoices)
            .where(
                and(
                    eq(openInvoices.type, "payable"),
                    sql`${openInvoices.status} IN ('open', 'partial')`,
                    sql`${openInvoices.dueDate} < ${todayStr}`,
                    branchScope(openInvoices.branchId, req),
                ),
            );

        // 7. Inventory Asset Value & Total SKUs
        const [inventoryAsset] = await db
            .select({
                totalValue: sql<number>`COALESCE(SUM(${stocks.qty} * ${productDetails.cost} / NULLIF(${productDetails.baseRatio}, 0)), 0)`,
                totalSkus: sql<number>`COUNT(DISTINCT ${stocks.productId})`,
            })
            .from(stocks)
            .innerJoin(
                productDetails,
                and(
                    eq(productDetails.productId, stocks.productId),
                    eq(productDetails.baseRatio, 1)
                )
            );

        // 8. Low Stock Items (using Level 1 / Default details)
        const lowStockItems = await db
            .select({
                productId: products.id,
                name: products.name,
                qty: sql<number>`COALESCE(SUM(${stocks.qty}), 0)`,
                reorderLevel: products.reorderLevel,
            })
            .from(products)
            .leftJoin(stocks, eq(stocks.productId, products.id))
            .where(eq(products.isActive, true))
            .groupBy(products.id, products.name, products.reorderLevel)
            .having(sql`COALESCE(SUM(${stocks.qty}), 0) <= COALESCE(NULLIF(${products.reorderLevel}, 0), 10)`)
            .limit(6);

        // 9. Top Selling Products (Top 5)
        const topSellingProducts = await db
            .select({
                productId: transactionDetails.productId,
                productName: products.name,
                totalQty: sql<number>`COALESCE(SUM(${transactionDetails.qty}), 0)`,
                totalRevenue: sql<number>`COALESCE(SUM(${transactionDetails.amount}), 0)`,
            })
            .from(transactionDetails)
            .innerJoin(transactions, eq(transactions.id, transactionDetails.transactionId))
            .innerJoin(products, eq(products.id, transactionDetails.productId))
            .where(
                and(
                    sql`${transactions.type} IN ('sales', 'pos_sales')`,
                    eq(transactions.status, "posted"),
                    branchScope(transactions.branchId, req),
                )
            )
            .groupBy(transactionDetails.productId, products.name)
            .orderBy(desc(sql`SUM(${transactionDetails.amount})`))
            .limit(5);

        // 10. Channel Breakdown (POS vs Direct Sales Order vs Marketplace)
        const channelBreakdown = await db
            .select({
                type: transactions.type,
                marketplaceId: transactions.marketplaceId,
                total: sql<number>`COALESCE(SUM(${transactions.totalAmount}), 0)`,
                count: sql<number>`count(*)`,
            })
            .from(transactions)
            .where(
                and(
                    sql`${transactions.type} IN ('sales', 'pos_sales')`,
                    eq(transactions.status, "posted"),
                    branchScope(transactions.branchId, req),
                )
            )
            .groupBy(transactions.type, transactions.marketplaceId);

        let posTotal = 0, posCount = 0;
        let marketplaceTotal = 0, marketplaceCount = 0;
        let directSalesTotal = 0, directSalesCount = 0;

        for (const ch of channelBreakdown) {
            const tot = Number(ch.total || 0);
            const cnt = Number(ch.count || 0);
            if (ch.marketplaceId) {
                marketplaceTotal += tot;
                marketplaceCount += cnt;
            } else if (ch.type === "pos_sales") {
                posTotal += tot;
                posCount += cnt;
            } else {
                directSalesTotal += tot;
                directSalesCount += cnt;
            }
        }

        // 11. Recent Transactions (with customer names)
        const recentTransactions = await db
            .select({
                id: transactions.id,
                type: transactions.type,
                invoice: transactions.invoice,
                date: transactions.date,
                totalAmount: transactions.totalAmount,
                status: transactions.status,
                contactName: contacts.name,
            })
            .from(transactions)
            .leftJoin(contacts, eq(transactions.contactId, contacts.id))
            .where(branchScope(transactions.branchId, req))
            .orderBy(desc(transactions.createdAt))
            .limit(6);

        // Sales growth
        const salesGrowth =
            Number(salesLastMonth.total) > 0
                ? ((Number(salesThisMonth.total) - Number(salesLastMonth.total)) / Number(salesLastMonth.total)) * 100
                : 0;

        res.json({
            sales: {
                today: {
                    count: Number(salesToday.count || 0),
                    total: Number(salesToday.total || 0),
                },
                thisMonth: {
                    count: Number(salesThisMonth.count || 0),
                    total: Number(salesThisMonth.total || 0),
                },
                growth: salesGrowth,
            },
            purchases: {
                thisMonth: {
                    count: Number(purchasesThisMonth.count || 0),
                    total: Number(purchasesThisMonth.total || 0),
                },
            },
            invoices: {
                receivables: {
                    count: Number(receivables.count || 0),
                    total: Number(receivables.total || 0),
                    overdueCount: Number(overdueReceivables.count || 0),
                    overdueTotal: Number(overdueReceivables.total || 0),
                },
                payables: {
                    count: Number(payables.count || 0),
                    total: Number(payables.total || 0),
                    overdueCount: Number(overduePayables.count || 0),
                    overdueTotal: Number(overduePayables.total || 0),
                },
            },
            inventory: {
                totalAssetValue: Number(inventoryAsset.totalValue || 0),
                totalSkus: Number(inventoryAsset.totalSkus || 0),
            },
            topSellingProducts: topSellingProducts.map((p) => ({
                productId: p.productId,
                name: p.productName,
                totalQty: Number(p.totalQty || 0),
                totalRevenue: Number(p.totalRevenue || 0),
            })),
            channels: {
                pos: { total: posTotal, count: posCount },
                marketplace: { total: marketplaceTotal, count: marketplaceCount },
                directSales: { total: directSalesTotal, count: directSalesCount },
            },
            lowStockItems: lowStockItems.map((item) => ({
                productId: item.productId,
                name: item.name,
                qty: Number(item.qty || 0),
                reorderLevel: Number(item.reorderLevel || 0),
            })),
            recentTransactions: recentTransactions.map((t) => ({
                ...t,
                totalAmount: Number(t.totalAmount || 0),
            })),
        });
    } catch (error) {
        console.error("Error fetching dashboard stats:", error);
        res.status(500).json({ message: "Failed to fetch dashboard stats" });
    }
};
