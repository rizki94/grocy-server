import { db } from "@/db";
import {
    contacts,
    productDetails,
    products,
    productUnits,
    stockMovements,
    stocks,
    taxes,
    transactionDetails,
    transactions,
    users,
    warehouses,
} from "@/db/schemas";
import {
    and,
    asc,
    desc,
    eq,
    inArray,
    like,
    or,
    sql,
    gte,
    lte,
    ne,
    gt,
} from "drizzle-orm";
import { PgColumn } from "drizzle-orm/pg-core";
import { Request, Response } from "express";
import {
    branchScope,
    productBranchFilter,
    resolveBranchCode,
    withBranch,
    resolveBranchId,
} from "@/helpers/branch.helper";
import { decomposeQuantity } from "@/helpers/quantity.helper";
import { generateInvoice } from "@/helpers/generate-invoice";

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
    const availableOnly =
        query.availableOnly === "true" || query.onlyAvailable === "true";
    const criticalOnly = query.criticalOnly === "true";

    const searchCondition = search
        ? or(
              like(sql`LOWER(${products.name})`, `%${search.toLowerCase()}%`),
              like(sql`LOWER(${warehouses.name})`, `%${search.toLowerCase()}%`),
          )
        : undefined;

    const warehouseCondition = warehouseId
        ? eq(stocks.warehouseId, warehouseId)
        : undefined;
    const availableCondition = availableOnly ? ne(stocks.qty, 0) : undefined;
    const branchCondition = branchScope(warehouses.branchId, req);
    const prodCondition = productBranchFilter(products, req);
    const criticalCondition = criticalOnly
        ? and(
              gt(products.reorderLevel, 0),
              sql`(
                  SELECT coalesce(sum(s2.qty), 0)
                  FROM stocks s2
                  WHERE s2.product_id = ${stocks.productId}
                    AND s2.warehouse_id = ${stocks.warehouseId}
              ) <= ${products.reorderLevel}`,
          )
        : undefined;

    const filterCondition = and(
        searchCondition,
        warehouseCondition,
        branchCondition,
        prodCondition,
        availableCondition,
        criticalCondition,
    );

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
                    reorderLevel: products.reorderLevel,
                })
                .from(stocks)
                .innerJoin(products, eq(stocks.productId, products.id))
                .leftJoin(warehouses, eq(warehouses.id, stocks.warehouseId))
                .leftJoin(
                    productDetails,
                    and(
                        eq(productDetails.productId, products.id),
                        eq(productDetails.baseRatio, 1),
                    ),
                )
                .leftJoin(
                    productUnits,
                    eq(productUnits.id, productDetails.unitId),
                )
                .where(filterCondition)
                .groupBy(
                    stocks.productId,
                    products.name,
                    warehouses.name,
                    productUnits.name,
                    productDetails.baseRatio,
                    products.reorderLevel,
                )
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
                .where(filterCondition),
        ]);

        const productIds = stockList.map((s) => s.productId);
        const allProductUnits =
            productIds.length > 0
                ? await db
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
                      .where(inArray(productDetails.productId, productIds))
                      .orderBy(desc(productDetails.baseRatio))
                : [];

        const rows = stockList.map((stock) => {
            const units = allProductUnits.filter(
                (u) => u.productId === stock.productId,
            );
            const baseQty = Number(stock.baseQty);
            const primaryRatio = Number(stock.baseRatio) || 1;

            return {
                ...stock,
                qty: baseQty / primaryRatio,
                reorderLevel: Number(stock.reorderLevel),
                decomposed: decomposeQuantity(baseQty, units),
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

export const getProductWarehouseStock = async (req: Request, res: Response) => {
    const { productId } = req.params;
    const warehouseId = req.query.warehouseId as string | undefined;

    if (!warehouseId) {
        return res.status(400).json({ message: "Warehouse is required" });
    }

    try {
        const [stock] = await db
            .select({
                baseQty: sql<number>`COALESCE(SUM(${stocks.qty}), 0)`,
            })
            .from(stocks)
            .innerJoin(products, eq(stocks.productId, products.id))
            .leftJoin(warehouses, eq(warehouses.id, stocks.warehouseId))
            .where(
                and(
                    eq(stocks.productId, productId),
                    eq(stocks.warehouseId, warehouseId),
                    branchScope(warehouses.branchId, req),
                    productBranchFilter(products, req),
                ),
            );

        return res.json({ baseQty: Number(stock?.baseQty ?? 0) });
    } catch (error) {
        console.error("Error fetching product warehouse stock:", error);
        return res
            .status(500)
            .json({ message: "Failed to fetch product warehouse stock" });
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

    const productId = (query.productId || query.product) as string | undefined;
    const warehouseId = (query.warehouseId || query.warehouse) as
        | string
        | undefined;
    const contactId = (query.contactId || query.contact) as string | undefined;
    const type = query.type as string | undefined;
    const from = (query.from || query.startDate) as string | undefined;
    const to = (query.to || query.endDate) as string | undefined;

    const fromDate = from
        ? from.includes("T")
            ? from.split("T")[0]
            : from
        : undefined;
    const toDate = to ? (to.includes("T") ? to.split("T")[0] : to) : undefined;

    const conditions = [
        branchScope(warehouses.branchId, req),
        productBranchFilter(products, req),
    ];

    if (productId && productId !== "all") {
        conditions.push(eq(stocks.productId, productId));
    }
    if (warehouseId && warehouseId !== "all") {
        conditions.push(eq(stocks.warehouseId, warehouseId));
    }
    if (contactId && contactId !== "all") {
        conditions.push(eq(transactions.contactId, contactId));
    }
    if (type && type !== "all") {
        conditions.push(eq(transactions.type, type as any));
    }
    if (fromDate) {
        conditions.push(gte(transactions.date, fromDate));
    }
    if (toDate) {
        conditions.push(lte(transactions.date, toDate));
    }

    const filterCondition = and(...conditions);

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
                    transactionType: transactions.type,
                })
                .from(stockMovements)
                .innerJoin(stocks, eq(stocks.id, stockMovements.stockId))
                .leftJoin(warehouses, eq(warehouses.id, stocks.warehouseId))
                .innerJoin(products, eq(stocks.productId, products.id))
                .leftJoin(
                    productDetails,
                    and(
                        eq(productDetails.productId, products.id),
                        eq(productDetails.baseRatio, 1),
                    ),
                )
                .leftJoin(
                    productUnits,
                    eq(productUnits.id, productDetails.unitId),
                )
                .innerJoin(
                    transactions,
                    eq(transactions.id, stockMovements.transactionId),
                )
                .leftJoin(contacts, eq(contacts.id, transactions.contactId))
                .where(filterCondition)
                .orderBy(order === "desc" ? desc(sortColumn) : asc(sortColumn))
                .limit(pageSize)
                .offset(offset),
            db
                .select({ count: sql<number>`count(*)` })
                .from(stockMovements)
                .innerJoin(stocks, eq(stocks.id, stockMovements.stockId))
                .leftJoin(warehouses, eq(warehouses.id, stocks.warehouseId))
                .innerJoin(products, eq(stocks.productId, products.id))
                .innerJoin(
                    transactions,
                    eq(transactions.id, stockMovements.transactionId),
                )
                .leftJoin(contacts, eq(contacts.id, transactions.contactId))
                .where(filterCondition),
        ]);

        const productIds = Array.from(
            new Set(stockMovementList.map((s) => s.productId)),
        );
        const allProductUnits =
            productIds.length > 0
                ? await db
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
                      .where(inArray(productDetails.productId, productIds))
                      .orderBy(desc(productDetails.baseRatio))
                : [];

        // Fetch transaction details to know the actual unit used
        const transactionIds = stockMovementList.map((s) => s.transactionId);
        const tDetails =
            transactionIds.length > 0
                ? await db
                      .select({
                          transactionId: transactionDetails.transactionId,
                          productId: transactionDetails.productId,
                          unitName: productUnits.name,
                          baseRatio: transactionDetails.baseRatio,
                          qty: transactionDetails.qty,
                      })
                      .from(transactionDetails)
                      .innerJoin(
                          productDetails,
                          eq(
                              productDetails.id,
                              transactionDetails.productDetailId,
                          ),
                      )
                      .innerJoin(
                          productUnits,
                          eq(productUnits.id, productDetails.unitId),
                      )
                      .where(
                          inArray(
                              transactionDetails.transactionId,
                              transactionIds,
                          ),
                      )
                : [];

        const rows = stockMovementList.map((mov) => {
            const units = allProductUnits.filter(
                (u) => u.productId === mov.productId,
            );
            const smallestUnit = units[units.length - 1];

            // Find the specific transaction detail
            const detail = tDetails.find(
                (d) =>
                    d.transactionId === mov.transactionId &&
                    d.productId === mov.productId &&
                    Math.abs(
                        Number(d.qty) * Number(d.baseRatio) -
                            Math.abs(Number(mov.baseQty)),
                    ) < 0.001,
            );

            const actualUnitQty = detail
                ? `${Number(detail.qty)} ${detail.unitName}`
                : `${mov.baseQty} ${mov.defaultUnitName}`;

            let smallestUnitQty = "";
            if (smallestUnit) {
                const count =
                    Math.abs(Number(mov.baseQty)) /
                    Number(smallestUnit.baseRatio);
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

// ── Low Stock & Restock Assistant Endpoints ─────────────────────────────────────

export const getLowStockProducts = async (req: Request, res: Response) => {
    try {
        const { warehouseId, threshold, search, supplierId, onlyZero } = req.query;

        // 1. Fetch active products with primary / default productDetails (Level 1 or Default)
        const prodCond = productBranchFilter(products, req);

        const primaryDetails = await db
            .select({
                productId: products.id,
                productName: products.name,
                reorderLevel: products.reorderLevel,
                useBatch: products.useBatch,
                productDetailId: productDetails.id,
                skuId: productDetails.skuId,
                barcode: productDetails.barcode,
                unitId: productDetails.unitId,
                unitName: productUnits.name,
                baseRatio: productDetails.baseRatio,
                cost: productDetails.cost,
                taxRate: sql<number>`COALESCE(${taxes.rate}, 0)`,
            })
            .from(products)
            .innerJoin(
                productDetails,
                and(
                    eq(productDetails.productId, products.id),
                    or(eq(productDetails.level, 1), eq(productDetails.isDefault, true))
                )
            )
            .leftJoin(productUnits, eq(productUnits.id, productDetails.unitId))
            .leftJoin(taxes, eq(taxes.id, products.taxId))
            .where(and(eq(products.isActive, true), prodCond))
            .orderBy(products.name);

        if (primaryDetails.length === 0) {
            return res.status(200).json({
                rows: [],
                summary: { totalItems: 0, totalOutOfStock: 0, estimatedTotalCost: 0 },
            });
        }

        // 2. Fetch stock sums (optionally filtered by warehouse)
        const stockConditions = [];
        if (warehouseId && warehouseId !== "all") {
            stockConditions.push(eq(stocks.warehouseId, warehouseId as string));
        }

        const stockRows = await db
            .select({
                productId: stocks.productId,
                totalBaseQty: sql<number>`COALESCE(SUM(${stocks.qty}), 0)`,
            })
            .from(stocks)
            .where(stockConditions.length > 0 ? and(...stockConditions) : undefined)
            .groupBy(stocks.productId);

        const stockMap = new Map<string, number>();
        for (const s of stockRows) {
            stockMap.set(s.productId, Number(s.totalBaseQty || 0));
        }

        // 3. Query all past purchase transactions for products with prices, supplier, and dates
        const purchaseHistory = await db
            .select({
                productId: transactionDetails.productId,
                contactId: transactions.contactId,
                contactName: contacts.name,
                price: transactionDetails.price,
                unitCost: transactionDetails.unitCost,
                date: transactions.date,
            })
            .from(transactionDetails)
            .innerJoin(transactions, eq(transactions.id, transactionDetails.transactionId))
            .innerJoin(contacts, eq(contacts.id, transactions.contactId))
            .where(and(eq(transactions.type, "purchase"), ne(transactions.status, "cancelled")))
            .orderBy(desc(transactions.date));

        // Group purchase history by productId -> map of supplierId -> latest purchase
        const todayDate = new Date();
        const maxValidDays = 180; // 6 months recency window

        interface SupplierHistoryEntry {
            supplierId: string;
            supplierName: string;
            price: number;
            date: string;
            daysAgo: number;
            isRecent: boolean;
        }

        const productSupplierHistoryMap = new Map<string, SupplierHistoryEntry[]>();

        for (const row of purchaseHistory) {
            if (!row.contactId || !row.contactName) continue;
            const pId = row.productId;
            if (!productSupplierHistoryMap.has(pId)) {
                productSupplierHistoryMap.set(pId, []);
            }
            const list = productSupplierHistoryMap.get(pId)!;
            // Only keep the most recent purchase for each unique supplier
            if (!list.some((item) => item.supplierId === row.contactId)) {
                const txDate = new Date(row.date);
                const diffTime = Math.abs(todayDate.getTime() - txDate.getTime());
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                const price = Number(row.price || row.unitCost || 0);

                list.push({
                    supplierId: row.contactId,
                    supplierName: row.contactName,
                    price,
                    date: row.date,
                    daysAgo: diffDays,
                    isRecent: diffDays <= maxValidDays,
                });
            }
        }

        // Evaluate suppliers for each product:
        // - Filter recent valid purchases (<= 180 days and price > 0)
        // - Pick the lowest price among recent purchases (CHEAPEST)
        // - If none recent, pick the latest purchase overall and flag as outdated
        interface RecommendedSupplier {
            supplierId: string;
            supplierName: string;
            price: number;
            date: string;
            daysAgo: number;
            isRecent: boolean;
            isCheapest: boolean;
            isPriceOutdated: boolean;
            alternatives: SupplierHistoryEntry[];
        }

        const recommendedSupplierMap = new Map<string, RecommendedSupplier>();

        for (const [pId, entries] of productSupplierHistoryMap.entries()) {
            if (entries.length === 0) continue;

            const recentEntries = entries.filter((e) => e.isRecent && e.price > 0);
            let chosen: SupplierHistoryEntry;
            let isCheapest = false;
            let isPriceOutdated = false;

            if (recentEntries.length > 0) {
                // Pick cheapest among recent
                recentEntries.sort((a, b) => a.price - b.price);
                chosen = recentEntries[0];
                isCheapest = recentEntries.length > 1;
            } else {
                // No recent purchase within 180 days: pick the most recent one
                entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
                chosen = entries[0];
                isPriceOutdated = true;
            }

            recommendedSupplierMap.set(pId, {
                supplierId: chosen.supplierId,
                supplierName: chosen.supplierName,
                price: chosen.price,
                date: chosen.date,
                daysAgo: chosen.daysAgo,
                isRecent: chosen.isRecent,
                isCheapest,
                isPriceOutdated,
                alternatives: entries,
            });
        }

        // 4. Default warehouse
        const [defaultWarehouse] = await db
            .select({ id: warehouses.id, name: warehouses.name })
            .from(warehouses)
            .limit(1);

        // 5. Filter low stock products
        const lowStockRows = [];
        for (const p of primaryDetails) {
            const baseQty = Number(stockMap.get(p.productId) || 0);
            const ratio = Number(p.baseRatio || 1) || 1;
            const currentQty = baseQty / ratio;
            const minLevel = Number(p.reorderLevel || 0);
            const effectiveThreshold = minLevel > 0 ? minLevel : (Number(threshold) || 10);

            if (currentQty <= effectiveThreshold) {
                if (onlyZero === "true" && currentQty > 0) continue;

                if (search) {
                    const sLower = String(search).toLowerCase();
                    const matchName = p.productName.toLowerCase().includes(sLower);
                    const matchSku = p.skuId?.toLowerCase().includes(sLower);
                    if (!matchName && !matchSku) continue;
                }

                const supp = recommendedSupplierMap.get(p.productId);
                if (supplierId && supplierId !== "all") {
                    if (supplierId === "none" && supp) continue;
                    if (supplierId !== "none" && supp?.supplierId !== supplierId) continue;
                }

                const targetStock = minLevel > 0 ? minLevel * 2 : 20;
                const suggestedQty = Math.max(1, Math.ceil(targetStock - currentQty));
                const effectiveCost = supp?.price && supp.price > 0 ? supp.price : Number(p.cost || 0);

                lowStockRows.push({
                    id: p.productDetailId,
                    productId: p.productId,
                    productName: p.productName,
                    productDetailId: p.productDetailId,
                    skuId: p.skuId,
                    barcode: p.barcode,
                    unitId: p.unitId,
                    unitName: p.unitName || "PCS",
                    cost: effectiveCost,
                    masterCost: Number(p.cost || 0),
                    baseRatio: ratio,
                    taxRate: Number(p.taxRate || 0),
                    warehouseId: (warehouseId && warehouseId !== "all") ? (warehouseId as string) : (defaultWarehouse?.id || ""),
                    warehouseName: defaultWarehouse?.name || "-",
                    currentQty,
                    reorderLevel: minLevel,
                    suggestedQty,
                    supplierId: supp?.supplierId || null,
                    supplierName: supp?.supplierName || null,
                    supplierPrice: supp?.price || null,
                    supplierDate: supp?.date || null,
                    supplierDaysAgo: supp?.daysAgo || null,
                    isRecentSupplier: supp?.isRecent || false,
                    isCheapestSupplier: supp?.isCheapest || false,
                    isPriceOutdated: supp?.isPriceOutdated || false,
                    supplierAlternatives: supp?.alternatives || [],
                });
            }
        }

        const totalOutOfStock = lowStockRows.filter((r) => r.currentQty <= 0).length;
        const estimatedTotalCost = lowStockRows.reduce(
            (sum, r) => sum + r.suggestedQty * r.cost,
            0
        );

        res.status(200).json({
            rows: lowStockRows,
            summary: {
                totalItems: lowStockRows.length,
                totalOutOfStock,
                estimatedTotalCost,
            },
        });
    } catch (error) {
        console.error("Error fetching low stock products:", error);
        res.status(500).json({ message: "Failed to fetch low stock products" });
    }
};

export const createRestockPurchaseDraft = async (req: Request, res: Response) => {
    const { contactId, warehouseId, note, reference, items, orders } = req.body;

    try {
        const orderList = Array.isArray(orders) && orders.length > 0
            ? orders
            : [{ contactId, warehouseId, note, reference, items }];

        const validOrders = orderList.filter((o: any) => Array.isArray(o.items) && o.items.length > 0);
        if (validOrders.length === 0) {
            return res.status(400).json({ message: "Item pengadaan tidak boleh kosong" });
        }

        const branchCode = await resolveBranchCode(req);
        const userIdCandidate = (req.user as any)?.id;
        const isUuid =
            typeof userIdCandidate === "string" &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userIdCandidate);
        let resolvedUserId = isUuid ? userIdCandidate : undefined;
        if (!resolvedUserId) {
            resolvedUserId = (await db.select({ id: users.id }).from(users).limit(1))[0]?.id;
        }

        if (!resolvedUserId) {
            return res.status(400).json({ message: "User is required to create purchase order" });
        }

        const results = [];

        for (const ord of validOrders) {
            const invoice = await generateInvoice("purchase", branchCode);
            const [createdPurchase] = await db
                .insert(transactions)
                .values(
                    await withBranch(
                        {
                            invoice,
                            type: "purchase",
                            status: "draft",
                            date: new Date().toISOString().split("T")[0],
                            contactId: ord.contactId || null,
                            termOfPayment: 0,
                            reference: ord.reference || `RESTOCK-${Date.now()}`,
                            note: ord.note || note || "Dibuat otomatis dari Restock Assistant (Pengadaan Stok Menipis/Habis)",
                            subtotal: 0,
                            totalDiscount: 0,
                            totalAmount: 0,
                            totalTax: 0,
                            userId: resolvedUserId,
                        },
                        req,
                    ),
                )
                .returning();

            let subtotal = 0;
            for (const item of ord.items) {
                const qty = Number(item.qty || 1);
                const price = Number(item.price ?? item.cost ?? 0);
                const amount = qty * price;
                subtotal += amount;

                await db.insert(transactionDetails).values({
                    transactionId: createdPurchase.id,
                    productId: item.productId,
                    productDetailId: item.productDetailId,
                    warehouseId: item.warehouseId || ord.warehouseId || warehouseId || null,
                    baseRatio: item.baseRatio || 1,
                    qty,
                    price,
                    discount: 0,
                    amount,
                    unitCost: price,
                    totalCost: amount,
                    taxRate: item.taxRate || 0,
                    movementType: 1,
                });
            }

            // Update purchase total amounts
            await db
                .update(transactions)
                .set({
                    subtotal,
                    totalAmount: subtotal,
                })
                .where(eq(transactions.id, createdPurchase.id));

            results.push({
                purchaseId: createdPurchase.id,
                invoice,
                contactId: ord.contactId,
                itemCount: ord.items.length,
                subtotal,
            });
        }

        const totalItemsCount = results.reduce((sum, r) => sum + r.itemCount, 0);
        const invoiceNames = results.map((r) => r.invoice).join(", ");

        res.status(201).json({
            message: `Berhasil membuat ${results.length} Draft PO (${invoiceNames}) mencakup ${totalItemsCount} produk`,
            results,
            purchaseId: results[0]?.purchaseId,
            invoice: results[0]?.invoice,
        });
    } catch (error: any) {
        console.error("Error creating restock draft PO:", error);
        res.status(500).json({ message: error.message || "Failed to create restock draft PO" });
    }
};

export const getExpiryStockReport = async (req: Request, res: Response) => {
    try {
        const query = req.query;
        const pageIndex = parseInt(query.pageIndex as string) || 0;
        const pageSize = parseInt(query.pageSize as string) || 10;
        const offset = pageIndex * pageSize;
        const search = (query.search as string) ?? "";
        const warehouseId = query.warehouseId as string | undefined;
        const statusFilter = (query.status as string) || "all"; // all, expired, near_30, near_60, near_90

        const branchCondition = branchScope(warehouses.branchId, req);
        const prodCondition = productBranchFilter(products, req);

        const conditions = [
            branchCondition,
            prodCondition,
            gt(stocks.qty, 0),
            sql`${stocks.expiryDate} IS NOT NULL`,
        ];

        if (warehouseId && warehouseId !== "all") {
            conditions.push(eq(stocks.warehouseId, warehouseId));
        }

        if (search) {
            conditions.push(
                or(
                    like(sql`LOWER(${products.name})`, `%${search.toLowerCase()}%`),
                    like(sql`LOWER(${stocks.batchNumber})`, `%${search.toLowerCase()}%`),
                ),
            );
        }

        const nowSql = sql`CURRENT_DATE`;
        if (statusFilter === "expired") {
            conditions.push(sql`${stocks.expiryDate} < ${nowSql}`);
        } else if (statusFilter === "near_30") {
            conditions.push(
                sql`${stocks.expiryDate} >= ${nowSql} AND ${stocks.expiryDate} <= (${nowSql} + INTERVAL '30 days')`,
            );
        } else if (statusFilter === "near_60") {
            conditions.push(
                sql`${stocks.expiryDate} >= ${nowSql} AND ${stocks.expiryDate} <= (${nowSql} + INTERVAL '60 days')`,
            );
        } else if (statusFilter === "near_90") {
            conditions.push(
                sql`${stocks.expiryDate} >= ${nowSql} AND ${stocks.expiryDate} <= (${nowSql} + INTERVAL '90 days')`,
            );
        }

        const filterCondition = and(...conditions);

        const [list, [totalCount]] = await Promise.all([
            db
                .select({
                    id: stocks.id,
                    productId: stocks.productId,
                    productName: products.name,
                    warehouseId: stocks.warehouseId,
                    warehouseName: warehouses.name,
                    batchNumber: stocks.batchNumber,
                    expiryDate: stocks.expiryDate,
                    qty: stocks.qty,
                    unitName: productUnits.name,
                    daysRemaining: sql<number>`CAST(${stocks.expiryDate} - ${nowSql} AS INTEGER)`,
                })
                .from(stocks)
                .innerJoin(products, eq(products.id, stocks.productId))
                .leftJoin(warehouses, eq(warehouses.id, stocks.warehouseId))
                .leftJoin(
                    productDetails,
                    and(
                        eq(productDetails.productId, products.id),
                        eq(productDetails.baseRatio, 1),
                    ),
                )
                .leftJoin(
                    productUnits,
                    eq(productUnits.id, productDetails.unitId),
                )
                .where(filterCondition)
                .orderBy(asc(stocks.expiryDate), products.name)
                .limit(pageSize)
                .offset(offset),
            db
                .select({ count: sql<number>`count(*)` })
                .from(stocks)
                .innerJoin(products, eq(products.id, stocks.productId))
                .leftJoin(warehouses, eq(warehouses.id, stocks.warehouseId))
                .where(filterCondition),
        ]);

        return res.json({
            rows: list,
            pageCount: Math.ceil(Number(totalCount?.count || 0) / pageSize),
            rowCount: Number(totalCount?.count || 0),
            pageIndex,
            pageSize,
        });
    } catch (error: any) {
        console.error("Error fetching expiry stock report:", error);
        return res.status(500).json({ message: "Failed to fetch expiry stock report" });
    }
};
