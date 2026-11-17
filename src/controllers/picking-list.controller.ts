import { db } from "@/db";
import {
    transactions,
    transactionDetails,
    products,
    productDetails,
    warehouses,
    contacts,
    productUnits,
    productAttributeValues,
    productAttributes,
} from "@/db/schemas";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Request, Response } from "express";

function decomposeUnits(
    baseQty: number,
    productUnitsList: { baseRatio: number | string; unitName: string; unitAbbr?: string | null }[],
): string | null {
    if (!productUnitsList || productUnitsList.length <= 1 || baseQty <= 0) return null;
    const isIntegerRatios = productUnitsList.every((r) =>
        Number.isInteger(Number(r.baseRatio)),
    );
    let remaining =
        isIntegerRatios && Math.abs(baseQty - Math.round(baseQty)) < 0.15
            ? Math.round(baseQty)
            : baseQty;

    const parts: string[] = [];
    for (const u of productUnitsList) {
        const ratio = Number(u.baseRatio || 1);
        if (ratio <= 1) continue;
        const count = Math.floor(remaining / ratio);
        if (count > 0) {
            parts.push(`${count} ${u.unitAbbr || u.unitName}`);
            remaining = Math.round((remaining % ratio) * 10000) / 10000;
        }
    }
    const baseUnit = productUnitsList.find((u) => Number(u.baseRatio) === 1);
    if (remaining > 0 && baseUnit) {
        const cleanCount =
            isIntegerRatios && Math.abs(remaining - Math.round(remaining)) < 0.15
                ? Math.round(remaining)
                : remaining;
        if (cleanCount > 0) {
            parts.push(`${cleanCount} ${baseUnit.unitAbbr || baseUnit.unitName}`);
        }
    }
    return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * GET /picking-list/invoices?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 * Returns posted sales invoices within the given date range.
 */
export const getInvoices = async (req: Request, res: Response) => {
    try {
        const { startDate, endDate } = req.query;

        if (!startDate) {
            return res
                .status(400)
                .json({ message: "startDate is required" });
        }

        const startStr = String(startDate).slice(0, 10);
        const endStr = endDate ? String(endDate).slice(0, 10) : startStr;

        const statusParam = req.query.status as string | undefined;
        const statusFilter = statusParam
            ? eq(transactions.status, statusParam as any)
            : inArray(transactions.status, ["posted", "paid"]);

        const rows = await db
            .select({
                id: transactions.id,
                invoice: transactions.invoice,
                date: transactions.date,
                status: transactions.status,
                customerName: contacts.name,
                customerAddress: contacts.address,
                customerPhone: contacts.phone,
                totalAmount: transactions.totalAmount,
            })
            .from(transactions)
            .leftJoin(contacts, eq(transactions.contactId, contacts.id))
            .where(
                and(
                    eq(transactions.type, "sales"),
                    statusFilter,
                    sql`${transactions.date} >= ${startStr}`,
                    sql`${transactions.date} <= ${endStr}`,
                ),
            )
            .orderBy(transactions.date, transactions.invoice);

        res.json(rows);
    } catch (error) {
        console.error("Error fetching invoices:", error);
        res.status(500).json({ message: "Failed to fetch invoices" });
    }
};

/**
 * POST /picking-list/process
 * Body: { ids: string[], groupBy: "product" | "warehouse" | string (attribute id) }
 * Returns a consolidated picking list grouped and summed by the chosen dimension.
 */
export const processPickingList = async (req: Request, res: Response) => {
    try {
        const { ids, groupBy = "product" } = req.body as {
            ids: string[];
            groupBy?: string;
        };

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res
                .status(400)
                .json({ message: "Transaction IDs are required" });
        }

        // Fetch the selected invoices metadata
        const invoiceList = await db
            .select({
                id: transactions.id,
                invoice: transactions.invoice,
                date: transactions.date,
                customerName: contacts.name,
            })
            .from(transactions)
            .leftJoin(contacts, eq(transactions.contactId, contacts.id))
            .where(inArray(transactions.id, ids));

        // Fetch all line items for the selected invoices
        const lines = await db
            .select({
                transactionId: transactionDetails.transactionId,
                productId: transactionDetails.productId,
                productName: products.name,
                productDetailId: transactionDetails.productDetailId,
                sku: productDetails.skuId,
                barcode: productDetails.barcode,
                unitId: productDetails.unitId,
                unitName: productUnits.name,
                unitAbbr: productUnits.abbreviation,
                warehouseId: transactionDetails.warehouseId,
                warehouseName: warehouses.name,
                qty: transactionDetails.qty,
                baseRatio: productDetails.baseRatio,
            })
            .from(transactionDetails)
            .innerJoin(products, eq(transactionDetails.productId, products.id))
            .innerJoin(
                productDetails,
                eq(transactionDetails.productDetailId, productDetails.id),
            )
            .innerJoin(productUnits, eq(productDetails.unitId, productUnits.id))
            .leftJoin(
                warehouses,
                eq(transactionDetails.warehouseId, warehouses.id),
            )
            .where(inArray(transactionDetails.transactionId, ids));

        // Determine groupBy key for each line
        let attributeMap: Record<string, string> = {}; // productId -> attribute value

        if (groupBy !== "product" && groupBy !== "warehouse") {
            // groupBy is an attribute ID — fetch values for relevant products
            const productIds = [...new Set(lines.map((l) => l.productId))];
            if (productIds.length > 0) {
                const attrValues = await db
                    .select({
                        productId: productAttributeValues.productId,
                        value: productAttributeValues.value,
                    })
                    .from(productAttributeValues)
                    .where(
                        and(
                            eq(
                                productAttributeValues.attributeId,
                                groupBy,
                            ),
                            inArray(productAttributeValues.productId, productIds),
                        ),
                    );
                attrValues.forEach((av) => {
                    attributeMap[av.productId] = av.value;
                });
            }
        }

        const productIdsAll = [...new Set(lines.map((l) => l.productId))];
        let allUnitsBatch: any[] = [];
        if (productIdsAll.length > 0) {
            allUnitsBatch = await db
                .select({
                    productId: productDetails.productId,
                    baseRatio: productDetails.baseRatio,
                    unitName: productUnits.name,
                    unitAbbr: productUnits.abbreviation,
                })
                .from(productDetails)
                .innerJoin(productUnits, eq(productDetails.unitId, productUnits.id))
                .where(inArray(productDetails.productId, productIdsAll))
                .orderBy(desc(productDetails.baseRatio));
        }

        // Build consolidated items: group by (groupKey, productDetailId)
        type ConsolidatedItem = {
            groupKey: string;
            productId: string;
            productName: string;
            sku: string;
            barcode: string | null;
            unitName: string;
            unitAbbr: string;
            warehouseName: string | null;
            baseRatio: number;
            totalQty: number;
            decomposedQty?: string | null;
            invoices: string[];
        };

        const consolidated: Record<string, ConsolidatedItem> = {};

        for (const line of lines) {
            let groupKey: string;
            if (groupBy === "product") {
                groupKey = "All Products";
            } else if (groupBy === "warehouse") {
                groupKey = line.warehouseName ?? "No Warehouse";
            } else {
                groupKey = attributeMap[line.productId] ?? "Uncategorised";
            }

            // Within a group, aggregate by productDetailId
            const key = `${groupKey}|||${line.productDetailId}`;

            const invoice = invoiceList.find(
                (inv) => inv.id === line.transactionId,
            )?.invoice ?? "";

            if (!consolidated[key]) {
                consolidated[key] = {
                    groupKey,
                    productId: line.productId,
                    productName: line.productName,
                    sku: line.sku,
                    barcode: line.barcode,
                    unitName: line.unitName,
                    unitAbbr: line.unitAbbr,
                    warehouseName: line.warehouseName,
                    baseRatio: Number(line.baseRatio || 1),
                    totalQty: 0,
                    decomposedQty: null,
                    invoices: [],
                };
            }

            consolidated[key].totalQty += Number(line.qty ?? 0);
            if (invoice && !consolidated[key].invoices.includes(invoice)) {
                consolidated[key].invoices.push(invoice);
            }
        }

        for (const item of Object.values(consolidated)) {
            const unitsForP = allUnitsBatch.filter((u) => u.productId === item.productId);
            const baseQty = item.totalQty * item.baseRatio;
            item.decomposedQty = decomposeUnits(baseQty, unitsForP);
        }

        // Sort and group output
        const items = Object.values(consolidated).sort((a, b) => {
            const g = a.groupKey.localeCompare(b.groupKey);
            if (g !== 0) return g;
            return a.productName.localeCompare(b.productName);
        });

        // Build groups
        const groups: Record<string, ConsolidatedItem[]> = {};
        for (const item of items) {
            if (!groups[item.groupKey]) groups[item.groupKey] = [];
            groups[item.groupKey].push(item);
        }

        res.json({
            invoices: invoiceList,
            groupBy,
            groups,
        });
    } catch (error) {
        console.error("Error processing picking list:", error);
        res.status(500).json({ message: "Failed to process picking list" });
    }
};

/**
 * GET /picking-list/:id
 * Single invoice picking list view.
 */
export const getPickingList = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
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

        const details = await db
            .select({
                productId: products.id,
                productName: products.name,
                warehouseName: warehouses.name,
                qty: transactionDetails.qty,
                baseRatio: productDetails.baseRatio,
                sku: productDetails.skuId,
                barcode: productDetails.barcode,
                unitName: productUnits.name,
                unitAbbr: productUnits.abbreviation,
            })
            .from(transactionDetails)
            .innerJoin(products, eq(transactionDetails.productId, products.id))
            .innerJoin(
                productDetails,
                eq(transactionDetails.productDetailId, productDetails.id),
            )
            .innerJoin(productUnits, eq(productDetails.unitId, productUnits.id))
            .leftJoin(
                warehouses,
                eq(transactionDetails.warehouseId, warehouses.id),
            )
            .where(eq(transactionDetails.transactionId, id))
            .orderBy(warehouses.name, products.name);

        const prodIds = [...new Set(details.map((d) => d.productId))];
        let allUnitsSingle: any[] = [];
        if (prodIds.length > 0) {
            allUnitsSingle = await db
                .select({
                    productId: productDetails.productId,
                    baseRatio: productDetails.baseRatio,
                    unitName: productUnits.name,
                    unitAbbr: productUnits.abbreviation,
                })
                .from(productDetails)
                .innerJoin(productUnits, eq(productDetails.unitId, productUnits.id))
                .where(inArray(productDetails.productId, prodIds))
                .orderBy(desc(productDetails.baseRatio));
        }

        const detailsWithDecomposed = details.map((d) => {
            const unitsForP = allUnitsSingle.filter((u) => u.productId === d.productId);
            const baseQty = Number(d.qty) * Number(d.baseRatio || 1);
            return {
                ...d,
                decomposedQty: decomposeUnits(baseQty, unitsForP),
            };
        });

        res.json({ transaction, details: detailsWithDecomposed });
    } catch (error) {
        console.error("Error fetching picking list:", error);
        res.status(500).json({ message: "Failed to fetch picking list" });
    }
};

/**
 * GET /picking-list/attributes
 * Returns available product attributes for grouping.
 */
export const getPickingListAttributes = async (_req: Request, res: Response) => {
    try {
        const rows = await db
            .select({
                id: productAttributes.id,
                name: productAttributes.name,
                label: productAttributes.label,
                type: productAttributes.type,
            })
            .from(productAttributes)
            .orderBy(productAttributes.name);

        res.json(rows);
    } catch (error) {
        console.error("Error fetching picking list attributes:", error);
        res.status(500).json({ message: "Failed to fetch attributes" });
    }
};



