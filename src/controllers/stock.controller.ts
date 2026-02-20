import { db } from "@/db";
import {
    contacts,
    productDetails,
    products,
    productUnits,
    stockMovements,
    stocks,
    transactions,
    warehouses,
} from "@/db/schemas";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { PgColumn } from "drizzle-orm/pg-core";
import { Request, Response } from "express";

export const getMonitoringStock = async (req: Request, res: Response) => {
    const query = req.query;
    const pageIndex = parseInt(query.pageIndex as string) || 0;
    const pageSize = parseInt(query.pageSize as string) || 5;
    const offset = pageIndex * pageSize;

    const sortColumns: Record<string, PgColumn> = {
        productName: products.name,
    };
    const sortKey = (query.sort as string) ?? "productName";
    const order = (query.order as string) === "desc" ? "desc" : "asc";

    const sortColumn = sortColumns[sortKey] ?? products.name;

    try {
        const [stockList, [totalCount]] = await Promise.all([
            db
                .select({
                    productId: stocks.productId,
                    productName: products.name,
                    warehouseName: warehouses.name,
                    unitName: productUnits.name,
                    qty: sql<number>`sum(${stocks.qty} / ${productDetails.baseRatio})`,
                })
                .from(stocks)
                .innerJoin(products, eq(stocks.productId, products.id))
                .leftJoin(warehouses, eq(warehouses.id, stocks.warehouseId))
                .innerJoin(
                    productDetails,
                    and(
                        eq(productDetails.productId, products.id),
                        eq(productDetails.isDefault, true),
                    ),
                )
                .innerJoin(
                    productUnits,
                    eq(productUnits.id, productDetails.unitId),
                )
                .groupBy(stocks.productId, products.name, warehouses.name, productUnits.name)
                .orderBy(order === "desc" ? desc(sortColumn) : asc(sortColumn))
                .limit(pageSize)
                .offset(offset),
            db
                .select({
                    count: sql<number>`count(DISTINCT ${stocks.productId})`,
                })
                .from(stocks)
                .innerJoin(products, eq(stocks.productId, products.id)),
        ]);

        res.json({
            rows: stockList,
            pageCount: Math.ceil(Number(totalCount?.count || 0) / pageSize),
            rowCount: Number(totalCount?.count || 0),
            pageIndex,
            pageSize,
            sort: sortKey,
            order,
        });
    } catch (error) {
        console.error("Error fetching stocks:", error);
        res.status(500).json({ message: "Failed to fetch stocks" });
    }
};

export const getMovementStocks = async (req: Request, res: Response) => {
    const query = req.query;
    const pageIndex = parseInt(query.pageIndex as string) || 0;
    const pageSize = parseInt(query.pageSize as string) || 5;
    const offset = pageIndex * pageSize;

    const sortColumns: Record<string, PgColumn> = {
        productName: products.name,
        transactionDate: transactions.date,
    };
    const sortKey = (query.sort as string) ?? "transactionDate";
    const order = (query.order as string) === "desc" ? "desc" : "asc";

    const sortColumn = sortColumns[sortKey] ?? transactions.date;

    try {
        const [stockMovementList, [totalCount]] = await Promise.all([
            db
                .select({
                    transactionId: transactions.id,
                    transactionInvoice: transactions.invoice,
                    transactionDate: transactions.date,
                    contactName: contacts.name,
                    productId: stocks.productId,
                    productName: products.name,
                    warehouseName: warehouses.name,
                    unitName: productUnits.name,
                    qty: stockMovements.qty,
                    type: stockMovements.type,
                })
                .from(stockMovements)
                .innerJoin(stocks, eq(stocks.id, stockMovements.stockId))
                .leftJoin(warehouses, eq(warehouses.id, stocks.warehouseId))
                .innerJoin(products, eq(stocks.productId, products.id))
                .innerJoin(
                    productDetails,
                    and(
                        eq(productDetails.productId, products.id),
                        eq(productDetails.isDefault, true),
                    ),
                )
                .innerJoin(
                    productUnits,
                    eq(productUnits.id, productDetails.unitId),
                )
                .innerJoin(
                    transactions,
                    eq(transactions.id, stockMovements.transactionId),
                )
                .leftJoin(contacts, eq(contacts.id, transactions.contactId))
                .orderBy(order === "desc" ? desc(sortColumn) : asc(sortColumn))
                .limit(pageSize)
                .offset(offset),
            db
                .select({ count: sql<number>`count(*)` })
                .from(stockMovements)
                .innerJoin(stocks, eq(stocks.id, stockMovements.stockId))
                .innerJoin(products, eq(stocks.productId, products.id)),
        ]);

        res.json({
            rows: stockMovementList,
            pageCount: Math.ceil(Number(totalCount?.count || 0) / pageSize),
            rowCount: Number(totalCount?.count || 0),
            pageIndex,
            pageSize,
            sort: sortKey,
            order,
        });
    } catch (error) {
        console.error("Error fetching stock movements:", error);
        res.status(500).json({ message: "Failed to fetch stock movements" });
    }
};
