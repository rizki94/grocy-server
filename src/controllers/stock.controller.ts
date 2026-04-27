import { db } from "@/db";
import {
    contacts,
    productDetails,
    products,
    productUnits,
    stockMovements,
    stocks,
    transactionDetails,
    transactions,
    warehouses,
} from "@/db/schemas";
import { and, asc, desc, eq, inArray, like, or, sql } from "drizzle-orm";
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
    const search = (query.search as string) ?? "";
    const warehouseId = query.warehouseId as string | undefined;

    const searchCondition = search
        ? or(
              like(sql`LOWER(${products.name})`, `%${search.toLowerCase()}%`),
              like(sql`LOWER(${warehouses.name})`, `%${search.toLowerCase()}%`),
          )
        : undefined;
    
    const warehouseCondition = warehouseId ? eq(stocks.warehouseId, warehouseId) : undefined;
    
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
                    baseRatio: productDetails.baseRatio,
                    baseQty: sql<number>`sum(${stocks.qty})`,
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
                .where(and(searchCondition, warehouseCondition))
                .groupBy(stocks.productId, products.name, warehouses.name, productUnits.name, productDetails.baseRatio)
                .orderBy(order === "desc" ? desc(sortColumn) : asc(sortColumn))
                .limit(pageSize)
                .offset(offset),
            db
                .select({
                    count: sql<number>`count(DISTINCT ${stocks.productId})`,
                })
                .from(stocks)
                .innerJoin(products, eq(stocks.productId, products.id))
                .leftJoin(warehouses, eq(warehouses.id, stocks.warehouseId))
                .where(and(searchCondition, warehouseCondition)),
        ]);

        const productIds = stockList.map((s) => s.productId);
        const allProductUnits = productIds.length > 0 ? await db
            .select({
                productId: productDetails.productId,
                unitName: productUnits.name,
                baseRatio: productDetails.baseRatio,
            })
            .from(productDetails)
            .innerJoin(productUnits, eq(productUnits.id, productDetails.unitId))
            .where(inArray(productDetails.productId, productIds))
            .orderBy(desc(productDetails.baseRatio)) : [];

        const rows = stockList.map((stock) => {
            const units = allProductUnits.filter((u) => u.productId === stock.productId);
            const baseQty = Number(stock.baseQty);
            const primaryRatio = Number(stock.baseRatio) || 1;
            
            let remaining = baseQty;
            const decomposed: string[] = [];
            
            for (const unit of units) {
                const unitRatio = Number(unit.baseRatio);
                const count = Math.floor(remaining / unitRatio + 0.0001);
                if (count > 0) {
                    decomposed.push(`${count} ${unit.unitName}`);
                    remaining = Number((remaining % unitRatio).toFixed(4));
                }
            }
            
            if (decomposed.length === 0 && baseQty > 0 && units.length > 0) {
                const smallestUnit = units[units.length - 1];
                const count = baseQty / Number(smallestUnit.baseRatio);
                decomposed.push(`${count.toFixed(0)} ${smallestUnit.unitName}`);
            }

            return {
                ...stock,
                qty: baseQty / primaryRatio,
                decomposed: decomposed.join(" "),
            };
        });

        res.json({
            rows,
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
                    defaultUnitName: productUnits.name,
                    baseQty: stockMovements.qty,
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

        const productIds = Array.from(new Set(stockMovementList.map((s) => s.productId)));
        const allProductUnits = productIds.length > 0 ? await db
            .select({
                productId: productDetails.productId,
                unitName: productUnits.name,
                baseRatio: productDetails.baseRatio,
            })
            .from(productDetails)
            .innerJoin(productUnits, eq(productUnits.id, productDetails.unitId))
            .where(inArray(productDetails.productId, productIds))
            .orderBy(desc(productDetails.baseRatio)) : [];

        // Fetch transaction details to know the actual unit used
        const transactionIds = stockMovementList.map(s => s.transactionId);
        const tDetails = transactionIds.length > 0 ? await db
            .select({
                transactionId: transactionDetails.transactionId,
                productId: transactionDetails.productId,
                unitName: productUnits.name,
                baseRatio: transactionDetails.baseRatio,
                qty: transactionDetails.qty,
            })
            .from(transactionDetails)
            .innerJoin(productDetails, eq(productDetails.id, transactionDetails.productDetailId))
            .innerJoin(productUnits, eq(productUnits.id, productDetails.unitId))
            .where(inArray(transactionDetails.transactionId, transactionIds)) : [];

        const rows = stockMovementList.map((mov) => {
            const units = allProductUnits.filter((u) => u.productId === mov.productId);
            const smallestUnit = units[units.length - 1];
            
            // Find the specific transaction detail
            const detail = tDetails.find(d => 
                d.transactionId === mov.transactionId && 
                d.productId === mov.productId &&
                Math.abs(Number(d.qty) * Number(d.baseRatio) - Math.abs(Number(mov.baseQty))) < 0.001
            );

            const actualUnitQty = detail ? `${Number(detail.qty)} ${detail.unitName}` : `${mov.baseQty} ${mov.defaultUnitName}`;
            
            let smallestUnitQty = "";
            if (smallestUnit) {
                const count = Math.abs(Number(mov.baseQty)) / Number(smallestUnit.baseRatio);
                smallestUnitQty = `${count.toFixed(0)} ${smallestUnit.unitName}`;
            }

            return {
                ...mov,
                actualDisplay: actualUnitQty,
                smallestDisplay: smallestUnitQty,
            };
        });

        res.json({
            rows,
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
