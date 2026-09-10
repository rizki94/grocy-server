import { db } from "@/db";
import {
    contacts,
    marketplaces,
    priceGroups,
    productDetailPrices,
    productDetails,
    products,
    productUnits,
    stocks,
    transactionDetails,
    transactions,
    warehouses,
} from "@/db/schemas";
import { generateInvoice } from "@/helpers/generate-invoice";
import { and, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { Request, Response } from "express";

interface ImportRow {
    sku: string;
    qty: number;
    invoice?: string;
    price?: number;
}

export const previewBridgeImport = async (req: Request, res: Response) => {
    try {
        const {
            platform,
            marketplaceId,
            contactId,
            warehouseId,
            rows = [],
        } = req.body as {
            platform?: string;
            marketplaceId?: string;
            contactId?: string;
            warehouseId?: string;
            rows: ImportRow[];
        };

        if (!Array.isArray(rows) || rows.length === 0) {
            return res.status(400).json({ message: "No rows provided for preview" });
        }

        // Fetch all active warehouses
        const allWarehouses = await db
            .select({
                id: warehouses.id,
                name: warehouses.name,
            })
            .from(warehouses)
            .where(eq(warehouses.isActive, true));

        const defaultWarehouse =
            allWarehouses.find((w) => w.id === warehouseId) ||
            allWarehouses[0];

        // Fetch contact details to determine price group
        let resolvedContactId = contactId || null;
        if (!resolvedContactId && (marketplaceId || platform)) {
            const [mp] = await db
                .select({ contactId: marketplaces.contactId })
                .from(marketplaces)
                .where(
                    marketplaceId
                        ? eq(marketplaces.id, marketplaceId)
                        : eq(marketplaces.code, (platform || "").toLowerCase())
                );
            if (mp?.contactId) resolvedContactId = mp.contactId;
        }

        let contactPriceGroupId: string | null = null;
        if (resolvedContactId) {
            const [c] = await db
                .select({ priceGroupId: contacts.priceGroupId })
                .from(contacts)
                .where(eq(contacts.id, resolvedContactId));
            if (c) contactPriceGroupId = c.priceGroupId;
        }

        // Extract unique normalized SKUs from input rows
        const normalizedSkuSet = new Set<string>();
        for (const row of rows) {
            if (row.sku) {
                normalizedSkuSet.add(row.sku.trim().toUpperCase());
            }
        }
        const skuArray = Array.from(normalizedSkuSet);

        // Query product_details matching sku_id or barcode
        const matchedDetails = skuArray.length > 0
            ? await db
                  .select({
                      detailId: productDetails.id,
                      productId: productDetails.productId,
                      productName: products.name,
                      skuId: productDetails.skuId,
                      barcode: productDetails.barcode,
                      level: productDetails.level,
                      ratio: productDetails.ratio,
                      baseRatio: productDetails.baseRatio,
                      cost: productDetails.cost,
                      unitId: productDetails.unitId,
                      unitName: productUnits.name,
                      isSellable: productDetails.isSellable,
                  })
                  .from(productDetails)
                  .innerJoin(products, eq(productDetails.productId, products.id))
                  .leftJoin(productUnits, eq(productDetails.unitId, productUnits.id))
                  .where(
                      or(
                          ...skuArray.map((sku) => ilike(productDetails.skuId, sku)),
                          ...skuArray.map((sku) => ilike(productDetails.barcode, sku))
                      )
                  )
            : [];

        // Build lookup map for product details by uppercase skuId and barcode
        const detailBySku = new Map<string, typeof matchedDetails[0]>();
        for (const d of matchedDetails) {
            if (d.skuId) detailBySku.set(d.skuId.toUpperCase(), d);
            if (d.barcode) detailBySku.set(d.barcode.toUpperCase(), d);
        }

        // Fetch prices for all matched product details
        const detailIds = matchedDetails.map((d) => d.detailId);
        const pricesList = detailIds.length > 0
            ? await db
                  .select({
                      productDetailId: productDetailPrices.productDetailId,
                      priceGroupId: productDetailPrices.priceGroupId,
                      price: productDetailPrices.price,
                  })
                  .from(productDetailPrices)
                  .where(inArray(productDetailPrices.productDetailId, detailIds))
            : [];

        // Map prices by detailId -> priceGroupId -> price
        const pricesByDetail = new Map<string, Map<string, number>>();
        for (const p of pricesList) {
            if (!pricesByDetail.has(p.productDetailId)) {
                pricesByDetail.set(p.productDetailId, new Map());
            }
            pricesByDetail.get(p.productDetailId)!.set(p.priceGroupId, Number(p.price));
        }

        // Fetch stock for all matched products grouped by product and warehouse
        const productIds = Array.from(new Set(matchedDetails.map((d) => d.productId)));
        const stockRows = productIds.length > 0
            ? await db
                  .select({
                      productId: stocks.productId,
                      warehouseId: stocks.warehouseId,
                      qty: stocks.qty,
                  })
                  .from(stocks)
                  .where(inArray(stocks.productId, productIds))
            : [];

        // Map stocks: productId -> warehouseId -> qty
        const stockMap = new Map<string, Map<string, number>>();
        for (const s of stockRows) {
            const wId = s.warehouseId || "default";
            if (!stockMap.has(s.productId)) {
                stockMap.set(s.productId, new Map());
            }
            const existingQty = stockMap.get(s.productId)!.get(wId) || 0;
            stockMap.get(s.productId)!.set(wId, existingQty + Number(s.qty));
        }

        // Check duplicate invoices in existing sales transactions
        const invoices = Array.from(
            new Set(rows.map((r) => r.invoice?.trim()).filter(Boolean))
        ) as string[];

        const existingInvoicesSet = new Set<string>();
        if (invoices.length > 0) {
            const existingTrx = await db
                .select({
                    invoice: transactions.invoice,
                    reference: transactions.reference,
                })
                .from(transactions)
                .where(
                    and(
                        eq(transactions.type, "sales"),
                        or(
                            inArray(transactions.invoice, invoices),
                            inArray(transactions.reference, invoices)
                        )
                    )
                );

            for (const t of existingTrx) {
                if (t.invoice) existingInvoicesSet.add(t.invoice);
                if (t.reference) existingInvoicesSet.add(t.reference);
            }
        }

        const matched: any[] = [];
        const unmatched: any[] = [];

        for (const row of rows) {
            const rawSku = (row.sku || "").trim();
            const normSku = rawSku.toUpperCase();
            const qty = Math.abs(Number(row.qty) || 0);
            const invoice = (row.invoice || "").trim();

            if (qty === 0) continue;

            const productDetail = detailBySku.get(normSku);
            if (!productDetail) {
                unmatched.push({
                    sku: rawSku,
                    qty,
                    invoice,
                    reason: `SKU '${rawSku}' not found in products list`,
                });
                continue;
            }

            // Determine unit price
            let price = 0;
            const detailPriceMap = pricesByDetail.get(productDetail.detailId);
            if (detailPriceMap) {
                if (contactPriceGroupId && detailPriceMap.has(contactPriceGroupId)) {
                    price = detailPriceMap.get(contactPriceGroupId)!;
                } else if (detailPriceMap.size > 0) {
                    price = detailPriceMap.values().next().value!;
                }
            }
            if (price === 0 && row.price && Number(row.price) > 0) {
                price = Number(row.price);
            }
            if (price === 0) {
                price = Number(productDetail.cost) || 0;
            }

            // Calculate available stock in base units & UI units
            const activeWarehouseId = defaultWarehouse?.id || "";
            const warehouseStockMap = stockMap.get(productDetail.productId);
            const baseStock = warehouseStockMap?.get(activeWarehouseId) || 0;
            const baseRatio = Number(productDetail.baseRatio) || 1;
            const stockInDetailUnit = Math.floor(baseStock / baseRatio);

            const isDuplicate = invoice ? existingInvoicesSet.has(invoice) : false;

            matched.push({
                sku: rawSku,
                sku_id: productDetail.skuId,
                barcode: productDetail.barcode,
                product_id: productDetail.productId,
                product_detail_id: productDetail.detailId,
                product_name: productDetail.productName,
                unit_id: productDetail.unitId,
                unit_name: productDetail.unitName,
                level: productDetail.level,
                ratio: productDetail.ratio,
                base_ratio: baseRatio,
                unit_cost: Number(productDetail.cost) || 0,
                qty,
                price,
                amount: qty * price,
                invoice,
                warehouse_id: activeWarehouseId,
                warehouse_name: defaultWarehouse?.name || "",
                stock: stockInDetailUnit,
                base_stock: baseStock,
                is_duplicate: isDuplicate,
                _selected: !isDuplicate,
            });
        }

        const totalAmount = matched.reduce((acc, m) => acc + m.amount, 0);
        const totalQty = matched.reduce((acc, m) => acc + m.qty, 0);

        return res.status(200).json({
            matched,
            unmatched,
            warehouses: allWarehouses,
            summary: {
                total_rows: rows.length,
                total_matched: matched.length,
                total_unmatched: unmatched.length,
                total_amount: totalAmount,
                total_qty: totalQty,
                total_duplicates: matched.filter((m) => m.is_duplicate).length,
            },
        });
    } catch (error: any) {
        console.error("Preview bridge import error:", error);
        return res.status(500).json({
            message: error.message || "Failed to generate preview",
        });
    }
};

export const submitBridgeImport = async (req: Request, res: Response) => {
    try {
        const { header, items } = req.body as {
            header: {
                platform?: string;
                marketplaceId?: string;
                contactId: string;
                warehouseId?: string;
                date: string;
                note?: string;
                reference?: string;
            };
            items: Array<{
                sku: string;
                qty: number;
                price: number;
                amount?: number;
                invoice?: string;
                product_detail_id: string;
                product_id: string;
                warehouse_id?: string;
                base_ratio?: number;
                unit_cost?: number;
            }>;
        };

        if (!header || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({
                message: "Header and valid items array are required",
            });
        }

        let resolvedContactId = header.contactId || null;
        let resolvedMarketplaceId = header.marketplaceId || null;

        if (!resolvedMarketplaceId && header.platform) {
            const [mp] = await db
                .select({ id: marketplaces.id, contactId: marketplaces.contactId })
                .from(marketplaces)
                .where(eq(marketplaces.code, header.platform.toLowerCase()));
            if (mp) {
                resolvedMarketplaceId = mp.id;
                if (!resolvedContactId) resolvedContactId = mp.contactId;
            }
        } else if (resolvedMarketplaceId && !resolvedContactId) {
            const [mp] = await db
                .select({ contactId: marketplaces.contactId })
                .from(marketplaces)
                .where(eq(marketplaces.id, resolvedMarketplaceId));
            if (mp) resolvedContactId = mp.contactId;
        }

        if (!resolvedContactId) {
            return res.status(400).json({
                message: "No customer contact mapped for this marketplace. Please map a customer in Master > Marketplace.",
            });
        }

        // Verify customer contact exists
        const [contact] = await db
            .select()
            .from(contacts)
            .where(eq(contacts.id, resolvedContactId));

        if (!contact) {
            return res.status(400).json({ message: "Selected customer contact not found" });
        }

        // Group items by invoice / order ID
        const itemsByInvoice = new Map<string, typeof items>();
        for (const item of items) {
            const inv = (item.invoice || "ORDER-" + Date.now()).trim();
            if (!itemsByInvoice.has(inv)) {
                itemsByInvoice.set(inv, []);
            }
            itemsByInvoice.get(inv)!.push(item);
        }

        const createdTransactions: any[] = [];

        await db.transaction(async (tx) => {
            for (const [orderRef, orderItems] of itemsByInvoice.entries()) {
                // Check if already imported
                const [existing] = await tx
                    .select({ id: transactions.id })
                    .from(transactions)
                    .where(
                        and(
                            eq(transactions.type, "sales"),
                            or(
                                eq(transactions.reference, orderRef),
                                eq(transactions.invoice, orderRef)
                            )
                        )
                    );

                if (existing) {
                    continue; // Skip already imported invoice
                }

                const generatedInvoice = await generateInvoice("sales");

                const subtotal = orderItems.reduce(
                    (acc, item) => acc + (Number(item.qty) * Number(item.price)),
                    0
                );
                const totalAmount = subtotal; // Can add tax if necessary

                const [newTrx] = await tx
                    .insert(transactions)
                    .values({
                        type: "sales",
                        invoice: generatedInvoice,
                        contactId: resolvedContactId,
                        marketplaceId: resolvedMarketplaceId,
                        date: header.date,
                        termOfPayment: contact.termOfPayment || 0,
                        reference: orderRef,
                        note: header.note || `Marketplace Import (${header.platform || "Online"}) - ${orderRef}`,
                        subtotal,
                        totalDiscount: 0,
                        totalTax: 0,
                        totalAmount,
                        status: "order",
                        userId: req.user!.id,
                    })
                    .returning();

                for (const item of orderItems) {
                    const itemQty = Number(item.qty);
                    const itemPrice = Number(item.price);
                    const itemAmount = itemQty * itemPrice;
                    const itemBaseRatio = Number(item.base_ratio) || 1;
                    const itemCost = Number(item.unit_cost) || 0;

                    await tx.insert(transactionDetails).values({
                        transactionId: newTrx.id,
                        productId: item.product_id,
                        productDetailId: item.product_detail_id,
                        warehouseId: item.warehouse_id || header.warehouseId || null,
                        movementType: -1, // OUT
                        qty: itemQty,
                        baseRatio: itemBaseRatio,
                        price: itemPrice,
                        discount: 0,
                        amount: itemAmount,
                        unitCost: itemCost,
                        totalCost: itemCost * itemQty,
                        taxRate: 0,
                    });
                }

                createdTransactions.push({
                    id: newTrx.id,
                    invoice: newTrx.invoice,
                    reference: newTrx.reference,
                    totalAmount: newTrx.totalAmount,
                    itemCount: orderItems.length,
                });
            }
        });

        return res.status(201).json({
            message: `Successfully created ${createdTransactions.length} sales orders`,
            transactions: createdTransactions,
        });
    } catch (error: any) {
        console.error("Submit bridge import error:", error);
        return res.status(500).json({
            message: error.message || "Failed to submit bridge import",
        });
    }
};
