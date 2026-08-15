import { Request, Response } from "express";
import { db } from "@/db";
import {
    transactions,
    transactionDetails,
    products,
    productDetails,
    productUnits,
    contacts,
    stocks,
    openInvoices,
} from "@/db/schemas";
import { eq, inArray, and, sql, or, desc } from "drizzle-orm";

export const analyzeBatchSales = async (req: Request, res: Response) => {
    try {
        const { orderIds } = req.body;

        if (!Array.isArray(orderIds) || orderIds.length === 0) {
            return res.status(400).json({ message: "No sales order IDs provided" });
        }

        // 1. Fetch selected orders
        const selectedOrders = await db
            .select({
                id: transactions.id,
                invoice: transactions.invoice,
                contactId: transactions.contactId,
                customerName: contacts.name,
                status: transactions.status,
                totalAmount: transactions.totalAmount,
                subtotal: transactions.subtotal,
                totalTax: transactions.totalTax,
                totalDiscount: transactions.totalDiscount,
                date: transactions.date,
            })
            .from(transactions)
            .innerJoin(contacts, eq(contacts.id, transactions.contactId))
            .where(
                and(
                    inArray(transactions.id, orderIds),
                    eq(transactions.type, "sales")
                )
            );

        if (!selectedOrders.length) {
            return res.status(404).json({ message: "No matching sales orders found" });
        }

        const validOrderIds = selectedOrders.map((o) => o.id);

        // 2. Fetch order line items
        const details = await db
            .select({
                detailId: transactionDetails.id,
                transactionId: transactionDetails.transactionId,
                productId: transactionDetails.productId,
                productName: products.name,
                productDetailId: transactionDetails.productDetailId,
                qty: transactionDetails.qty,
                baseRatio: transactionDetails.baseRatio,
                price: transactionDetails.price,
                discount: transactionDetails.discount,
                amount: transactionDetails.amount,
                unitCost: transactionDetails.unitCost,
                unitName: productUnits.name,
            })
            .from(transactionDetails)
            .innerJoin(products, eq(products.id, transactionDetails.productId))
            .leftJoin(
                productDetails,
                eq(productDetails.id, transactionDetails.productDetailId)
            )
            .leftJoin(productUnits, eq(productUnits.id, productDetails.unitId))
            .where(inArray(transactionDetails.transactionId, validOrderIds));

        // 3. Stock Analytics
        // Calculate total required base qty per product across all selected orders
        const requiredPerProduct: Record<
            string,
            {
                productId: string;
                productName: string;
                totalRequiredBaseQty: number;
                items: Array<{
                    orderId: string;
                    invoice: string;
                    customerName: string;
                    detailId: string;
                    qty: number;
                    baseRatio: number;
                    unitName: string;
                    discount: number;
                    price: number;
                }>;
            }
        > = {};

        for (const d of details) {
            const order = selectedOrders.find((o) => o.id === d.transactionId);
            if (!order) continue;

            const baseQty = Number(d.qty) * Number(d.baseRatio);

            if (!requiredPerProduct[d.productId]) {
                requiredPerProduct[d.productId] = {
                    productId: d.productId,
                    productName: d.productName,
                    totalRequiredBaseQty: 0,
                    items: [],
                };
            }

            requiredPerProduct[d.productId].totalRequiredBaseQty += baseQty;
            requiredPerProduct[d.productId].items.push({
                orderId: d.transactionId,
                invoice: order.invoice,
                customerName: order.customerName,
                detailId: d.detailId,
                qty: Number(d.qty),
                baseRatio: Number(d.baseRatio),
                unitName: d.unitName || "",
                discount: Number(d.discount || 0),
                price: Number(d.price),
            });
        }

        // Fetch current stocks for involved products
        const involvedProductIds = Object.keys(requiredPerProduct);
        const availableStocks: Record<string, number> = {};
        const productUnitsMap: Record<
            string,
            Array<{ unitName: string; baseRatio: number }>
        > = {};

        if (involvedProductIds.length > 0) {
            const stockRows = await db
                .select({
                    productId: stocks.productId,
                    totalQuantity: sql<number>`COALESCE(SUM(${stocks.qty}), 0)`,
                })
                .from(stocks)
                .where(inArray(stocks.productId, involvedProductIds))
                .groupBy(stocks.productId);

            for (const s of stockRows) {
                availableStocks[s.productId] = Number(s.totalQuantity || 0);
            }

            const unitRows = await db
                .select({
                    productId: productDetails.productId,
                    unitName: productUnits.name,
                    baseRatio: productDetails.baseRatio,
                })
                .from(productDetails)
                .innerJoin(
                    productUnits,
                    eq(productUnits.id, productDetails.unitId),
                )
                .where(inArray(productDetails.productId, involvedProductIds))
                .orderBy(desc(productDetails.baseRatio));

            for (const u of unitRows) {
                if (!productUnitsMap[u.productId]) {
                    productUnitsMap[u.productId] = [];
                }
                productUnitsMap[u.productId].push({
                    unitName: u.unitName,
                    baseRatio: Number(u.baseRatio),
                });
            }
        }

        const stockAnalytics: any[] = [];
        for (const pid of involvedProductIds) {
            const reqData = requiredPerProduct[pid];
            const avail = availableStocks[pid] || 0;
            const deficit = reqData.totalRequiredBaseQty - avail;

            if (deficit > 0) {
                stockAnalytics.push({
                    productId: pid,
                    productName: reqData.productName,
                    availableStock: avail,
                    totalRequiredStock: reqData.totalRequiredBaseQty,
                    deficit,
                    units: productUnitsMap[pid] || [],
                    orderItems: reqData.items,
                });
            }
        }

        // 4. Customer Limit Analytics (Credit Limit & Invoice Limit)
        const uniqueCustomerIds = [
            ...new Set(
                selectedOrders
                    .map((o) => o.contactId)
                    .filter((id): id is string => Boolean(id))
            ),
        ];

        const limitAnalytics: any[] = [];

        if (uniqueCustomerIds.length > 0) {
            const customerInfos = await db
                .select({
                    id: contacts.id,
                    name: contacts.name,
                    creditLimit: contacts.creditLimit,
                    invoiceLimit: contacts.invoiceLimit,
                })
                .from(contacts)
                .where(inArray(contacts.id, uniqueCustomerIds));

            // Query open invoices for these customers
            const openInvoiceStats = await db
                .select({
                    contactId: openInvoices.contactId,
                    unpaidAmount: sql<number>`COALESCE(SUM(${openInvoices.amount} - ${openInvoices.paidAmount}), 0)`,
                    unpaidCount: sql<number>`COUNT(*)`,
                })
                .from(openInvoices)
                .where(
                    and(
                        inArray(openInvoices.contactId, uniqueCustomerIds),
                        or(
                            eq(openInvoices.status, "open"),
                            eq(openInvoices.status, "partial")
                        )
                    )
                )
                .groupBy(openInvoices.contactId);

            const openStatsMap: Record<
                string,
                { unpaidAmount: number; unpaidCount: number }
            > = {};
            for (const stat of openInvoiceStats) {
                if (stat.contactId) {
                    openStatsMap[stat.contactId] = {
                        unpaidAmount: Number(stat.unpaidAmount || 0),
                        unpaidCount: Number(stat.unpaidCount || 0),
                    };
                }
            }

            for (const cust of customerInfos) {
                const custOrders = selectedOrders.filter(
                    (o) => o.contactId === cust.id
                );
                const batchAmount = custOrders.reduce(
                    (sum, o) => sum + Number(o.totalAmount || 0),
                    0
                );
                const batchCount = custOrders.length;

                const currentStat = openStatsMap[cust.id] || {
                    unpaidAmount: 0,
                    unpaidCount: 0,
                };

                const creditLimitNum = Number(cust.creditLimit || 0);
                const invoiceLimitNum = Number(cust.invoiceLimit || 0);

                const totalProjectedAmount = currentStat.unpaidAmount + batchAmount;
                const totalProjectedCount = currentStat.unpaidCount + batchCount;

                const exceedsCreditLimit =
                    creditLimitNum > 0 && totalProjectedAmount > creditLimitNum;
                const exceedsInvoiceLimit =
                    invoiceLimitNum > 0 && totalProjectedCount > invoiceLimitNum;

                if (exceedsCreditLimit || exceedsInvoiceLimit) {
                    limitAnalytics.push({
                        customerId: cust.id,
                        customerName: cust.name,
                        creditLimit: creditLimitNum,
                        currentUnpaidAmount: currentStat.unpaidAmount,
                        batchAmount,
                        totalProjectedAmount,
                        exceedsCreditLimit,
                        invoiceLimit: invoiceLimitNum,
                        currentUnpaidCount: currentStat.unpaidCount,
                        batchCount,
                        totalProjectedCount,
                        exceedsInvoiceLimit,
                        orderIds: custOrders.map((o) => o.id),
                        orders: custOrders.map((o) => ({
                            id: o.id,
                            invoice: o.invoice,
                            amount: Number(o.totalAmount),
                        })),
                    });
                }
            }
        }

        // 5. Price & Discount Analytics
        const priceDiscountAnalytics: any[] = [];
        for (const d of details) {
            const discountNum = Number(d.discount || 0);
            if (discountNum > 0) {
                const order = selectedOrders.find((o) => o.id === d.transactionId);
                priceDiscountAnalytics.push({
                    orderId: d.transactionId,
                    invoice: order?.invoice || "",
                    customerName: order?.customerName || "",
                    detailId: d.detailId,
                    productId: d.productId,
                    productName: d.productName,
                    price: Number(d.price),
                    qty: Number(d.qty),
                    discount: discountNum,
                    amount: Number(d.amount),
                });
            }
        }

        return res.json({
            orders: selectedOrders,
            stockAnalytics,
            limitAnalytics,
            priceDiscountAnalytics,
        });
    } catch (error: any) {
        console.error("Batch analyze error:", error);
        return res
            .status(500)
            .json({ message: error.message || "Failed to analyze batch sales" });
    }
};

export const updateBatchSalesItems = async (req: Request, res: Response) => {
    try {
        const { itemUpdates, detailRemovals } = req.body;

        await db.transaction(async (tx) => {
            // Removals
            if (Array.isArray(detailRemovals) && detailRemovals.length > 0) {
                await tx
                    .delete(transactionDetails)
                    .where(inArray(transactionDetails.id, detailRemovals));
            }

            // Updates (qty, discount, productId, etc.)
            if (Array.isArray(itemUpdates) && itemUpdates.length > 0) {
                for (const update of itemUpdates) {
                    const { detailId, qty, discount, productId, productDetailId, price } = update;

                    const updateData: any = {};
                    if (qty !== undefined) updateData.qty = qty;
                    if (discount !== undefined) updateData.discount = discount;
                    if (productId) updateData.productId = productId;
                    if (productDetailId) updateData.productDetailId = productDetailId;
                    if (price !== undefined) updateData.price = price;

                    // Recalculate line amount
                    if (qty !== undefined || price !== undefined || discount !== undefined) {
                        const [existing] = await tx
                            .select()
                            .from(transactionDetails)
                            .where(eq(transactionDetails.id, detailId));

                        if (existing) {
                            const curQty = qty !== undefined ? qty : Number(existing.qty);
                            const curPrice = price !== undefined ? price : Number(existing.price);
                            const curDisc = discount !== undefined ? discount : Number(existing.discount || 0);
                            updateData.amount = curQty * curPrice - curDisc;
                        }
                    }

                    if (Object.keys(updateData).length > 0) {
                        await tx
                            .update(transactionDetails)
                            .set(updateData)
                            .where(eq(transactionDetails.id, detailId));
                    }
                }
            }

            // Recalculate transaction totals for affected transactions
            const affectedDetails = await tx
                .select({
                    transactionId: transactionDetails.transactionId,
                    amount: transactionDetails.amount,
                    discount: transactionDetails.discount,
                })
                .from(transactionDetails)
                .where(
                    inArray(
                        transactionDetails.id,
                        (itemUpdates || []).map((u: any) => u.detailId)
                    )
                );

            const affectedTxIds = [
                ...new Set(affectedDetails.map((d) => d.transactionId)),
            ];

            for (const txId of affectedTxIds) {
                const txDetails = await tx
                    .select()
                    .from(transactionDetails)
                    .where(eq(transactionDetails.transactionId, txId));

                const newSubtotal = txDetails.reduce(
                    (sum, d) => sum + Number(d.qty) * Number(d.price),
                    0
                );
                const newTotalDiscount = txDetails.reduce(
                    (sum, d) => sum + Number(d.discount || 0),
                    0
                );
                const newTotalAmount = newSubtotal - newTotalDiscount;

                await tx
                    .update(transactions)
                    .set({
                        subtotal: newSubtotal,
                        totalDiscount: newTotalDiscount,
                        totalAmount: newTotalAmount,
                    })
                    .where(eq(transactions.id, txId));
            }
        });

        return res.json({ message: "Batch items updated successfully" });
    } catch (error: any) {
        console.error("Batch update items error:", error);
        return res
            .status(500)
            .json({ message: error.message || "Failed to update batch items" });
    }
};
