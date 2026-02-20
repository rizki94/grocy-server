import { db } from "@/db";
import {
    transactions,
    transactionDetails,
    products,
    warehouses,
    contacts,
    productDetails,
} from "@/db/schemas";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Request, Response } from "express";

export const getPickingList = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        // Get the sales transaction
        const [transaction] = await db
            .select({
                id: transactions.id,
                invoice: transactions.invoice,
                date: transactions.date,
                status: transactions.status,
                customerName: contacts.name,
                customerAddress: contacts.address,
                customerPhone: contacts.phone,
            })
            .from(transactions)
            .leftJoin(contacts, eq(transactions.contactId, contacts.id))
            .where(
                and(eq(transactions.id, id), eq(transactions.type, "sales")),
            );

        if (!transaction) {
            return res
                .status(404)
                .json({ message: "Sales transaction not found" });
        }

        // Get transaction details with product and warehouse info
        const details = await db
            .select({
                productName: products.name,
                warehouseName: warehouses.name,
                qty: transactionDetails.qty,
                sku: productDetails.skuId,
                barcode: productDetails.barcode,
            })
            .from(transactionDetails)
            .innerJoin(products, eq(transactionDetails.productId, products.id))
            .innerJoin(
                productDetails,
                eq(transactionDetails.productDetailId, productDetails.id),
            )
            .where(eq(transactionDetails.transactionId, id))
            .orderBy(warehouses.name, products.name);

        res.json({
            transaction,
            details,
        });
    } catch (error) {
        console.error("Error fetching picking list:", error);
        res.status(500).json({ message: "Failed to fetch picking list" });
    }
};

export const getBulkPickingList = async (req: Request, res: Response) => {
    try {
        const { ids } = req.body;

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res
                .status(400)
                .json({ message: "Transaction IDs are required" });
        }

        // Get all sales transactions
        const transactionsList = await db
            .select({
                id: transactions.id,
                invoice: transactions.invoice,
                date: transactions.date,
                status: transactions.status,
                customerName: contacts.name,
            })
            .from(transactions)
            .leftJoin(contacts, eq(transactions.contactId, contacts.id))
            .where(
                and(
                    inArray(transactions.id, ids),
                    eq(transactions.type, "sales"),
                ),
            );

        // Get all details for these transactions
        const allDetails = await db
            .select({
                transactionId: transactionDetails.transactionId,
                productName: products.name,
                warehouseName: warehouses.name,
                qty: transactionDetails.qty,
                sku: productDetails.skuId,
                barcode: productDetails.barcode,
            })
            .from(transactionDetails)
            .innerJoin(products, eq(transactionDetails.productId, products.id))
            .innerJoin(
                productDetails,
                eq(transactionDetails.productDetailId, productDetails.id),
            )
            .where(inArray(transactionDetails.transactionId, ids))
            .orderBy(warehouses.name, products.name);

        // Group details by transaction
        const result = transactionsList.map((trans) => ({
            transaction: trans,
            details: allDetails.filter((d) => d.transactionId === trans.id),
        }));

        res.json(result);
    } catch (error) {
        console.error("Error fetching bulk picking list:", error);
        res.status(500).json({ message: "Failed to fetch bulk picking list" });
    }
};

export const getPickingListByDateRange = async (
    req: Request,
    res: Response,
) => {
    try {
        const { startDate, endDate } = req.query;

        if (!startDate || !endDate) {
            return res
                .status(400)
                .json({ message: "Start date and end date are required" });
        }

        // Get all sales transactions within date range
        const transactionsList = await db
            .select({
                id: transactions.id,
                invoice: transactions.invoice,
                date: transactions.date,
                status: transactions.status,
                customerName: contacts.name,
                customerAddress: contacts.address,
                customerPhone: contacts.phone,
            })
            .from(transactions)
            .leftJoin(contacts, eq(transactions.contactId, contacts.id))
            .where(
                and(
                    eq(transactions.type, "sales"),
                    sql`${transactions.date} >= ${startDate}`,
                    sql`${transactions.date} <= ${endDate}`,
                ),
            )
            .orderBy(transactions.date, transactions.invoice);

        if (transactionsList.length === 0) {
            return res.json([]);
        }

        const transactionIds = transactionsList.map((t) => t.id);

        // Get all details for these transactions
        const allDetails = await db
            .select({
                transactionId: transactionDetails.transactionId,
                productName: products.name,
                warehouseName: warehouses.name,
                qty: transactionDetails.qty,
                sku: productDetails.skuId,
                barcode: productDetails.barcode,
            })
            .from(transactionDetails)
            .innerJoin(products, eq(transactionDetails.productId, products.id))
            .innerJoin(
                productDetails,
                eq(transactionDetails.productDetailId, productDetails.id),
            )
            .where(inArray(transactionDetails.transactionId, transactionIds))
            .orderBy(warehouses.name, products.name);

        // Group details by transaction
        const result = transactionsList.map((trans) => ({
            transaction: trans,
            details: allDetails.filter((d) => d.transactionId === trans.id),
        }));

        res.json(result);
    } catch (error) {
        console.error("Error fetching picking list by date range:", error);
        res.status(500).json({
            message: "Failed to fetch picking list by date range",
        });
    }
};
