import { Request, Response } from "express";
import { db } from "@/db";
import {
    transactions,
    transactionDetails,
    productDetails,
    products,
    productUnits,
    contacts,
    routeGroups,
    deliveries,
    deliveryItems,
    drivers,
    trucks,
} from "@/db/schemas";
import { eq, inArray, and, gte, lte, sql, notInArray, desc, like, or } from "drizzle-orm";
import { parseTableQuery } from "@/services/table-query";

export const getUnassignedInvoices = async (req: Request, res: Response) => {
    try {
        const { routeGroupId, date } = req.query;

        // 1. Get all transaction IDs currently assigned to active deliveries
        const assignedItems = await db
            .select({ transactionId: deliveryItems.transactionId })
            .from(deliveryItems)
            .innerJoin(deliveries, eq(deliveries.id, deliveryItems.deliveryId))
            .where(sql`${deliveries.status} != 'cancelled'`);

        const assignedTransactionIds = assignedItems.map((i) => i.transactionId);

        // 2. Build conditions for posted transactions
        const conditions: any[] = [
            eq(transactions.type, "sales"),
            eq(transactions.status, "posted"),
        ];

        if (assignedTransactionIds.length > 0) {
            conditions.push(notInArray(transactions.id, assignedTransactionIds));
        }

        if (routeGroupId && typeof routeGroupId === "string" && routeGroupId !== "all") {
            conditions.push(eq(contacts.routeGroupId, routeGroupId));
        }

        if (date && typeof date === "string") {
            conditions.push(eq(transactions.date, date));
        }

        const postedInvoices = await db
            .select({
                id: transactions.id,
                invoice: transactions.invoice,
                date: transactions.date,
                totalAmount: transactions.totalAmount,
                customerName: contacts.name,
                customerAddress: contacts.address,
                customerPhone: contacts.phone,
                routeGroupId: contacts.routeGroupId,
                routeGroupName: routeGroups.name,
            })
            .from(transactions)
            .innerJoin(contacts, eq(contacts.id, transactions.contactId))
            .leftJoin(routeGroups, eq(routeGroups.id, contacts.routeGroupId))
            .where(and(...conditions))
            .orderBy(transactions.invoice);

        if (postedInvoices.length === 0) {
            return res.status(200).json([]);
        }

        // 3. Fetch product detail dimensions and calculate weights & volumes
        const postedIds = postedInvoices.map((inv) => inv.id);
        const details = await db
            .select({
                transactionId: transactionDetails.transactionId,
                qty: transactionDetails.qty,
                baseRatio: transactionDetails.baseRatio,
                weight: productDetails.weight,
                length: productDetails.length,
                width: productDetails.width,
                height: productDetails.height,
            })
            .from(transactionDetails)
            .innerJoin(
                productDetails,
                eq(productDetails.id, transactionDetails.productDetailId),
            )
            .where(inArray(transactionDetails.transactionId, postedIds));

        const invoiceMetrics: Record<
            string,
            { totalWeight: number; totalVolume: number }
        > = {};

        for (const d of details) {
            const baseQty = Number(d.qty) * Number(d.baseRatio);
            const w = Number(d.weight || 0) * baseQty;
            const vol =
                Number(d.length || 0) *
                Number(d.width || 0) *
                Number(d.height || 0) *
                baseQty;

            if (!invoiceMetrics[d.transactionId]) {
                invoiceMetrics[d.transactionId] = {
                    totalWeight: 0,
                    totalVolume: 0,
                };
            }
            invoiceMetrics[d.transactionId].totalWeight += w;
            invoiceMetrics[d.transactionId].totalVolume += vol;
        }

        const result = postedInvoices.map((inv) => ({
            ...inv,
            totalWeight: Number(
                (invoiceMetrics[inv.id]?.totalWeight || 0).toFixed(2),
            ),
            totalVolume: Number(
                (invoiceMetrics[inv.id]?.totalVolume || 0).toFixed(3),
            ),
        }));

        return res.status(200).json(result);
    } catch (error) {
        console.error("Error fetching unassigned invoices:", error);
        return res
            .status(500)
            .json({ message: "Failed to fetch unassigned invoices" });
    }
};

export const getDispatchBoard = async (req: Request, res: Response) => {
    try {
        const targetDate =
            (req.query.date as string) || new Date().toISOString().split("T")[0];

        // Fetch deliveries for target date
        const activeDeliveries = await db
            .select({
                id: deliveries.id,
                loadNumber: deliveries.loadNumber,
                deliveryDate: deliveries.deliveryDate,
                driverId: deliveries.driverId,
                driverName: drivers.name,
                driverColor: drivers.color,
                truckId: deliveries.truckId,
                truckName: trucks.name,
                truckPlate: trucks.licensePlate,
                maxWeight: trucks.maxWeight,
                maxVolume: trucks.maxVolume,
                status: deliveries.status,
                notes: deliveries.notes,
                createdAt: deliveries.createdAt,
            })
            .from(deliveries)
            .innerJoin(drivers, eq(drivers.id, deliveries.driverId))
            .innerJoin(trucks, eq(trucks.id, deliveries.truckId))
            .where(eq(deliveries.deliveryDate, targetDate));

        const deliveryIds = activeDeliveries.map((d) => d.id);

        let assignedInvoiceItems: any[] = [];
        if (deliveryIds.length > 0) {
            assignedInvoiceItems = await db
                .select({
                    deliveryId: deliveryItems.deliveryId,
                    sequence: deliveryItems.sequence,
                    id: transactions.id,
                    invoice: transactions.invoice,
                    date: transactions.date,
                    totalAmount: transactions.totalAmount,
                    customerName: contacts.name,
                    customerAddress: contacts.address,
                    customerPhone: contacts.phone,
                    routeGroupName: routeGroups.name,
                })
                .from(deliveryItems)
                .innerJoin(
                    transactions,
                    eq(transactions.id, deliveryItems.transactionId),
                )
                .innerJoin(contacts, eq(contacts.id, transactions.contactId))
                .leftJoin(
                    routeGroups,
                    eq(routeGroups.id, contacts.routeGroupId),
                )
                .where(inArray(deliveryItems.deliveryId, deliveryIds))
                .orderBy(deliveryItems.sequence);
        }

        const assignedTxIds = assignedInvoiceItems.map((item) => item.id);
        const details =
            assignedTxIds.length > 0
                ? await db
                      .select({
                          transactionId: transactionDetails.transactionId,
                          qty: transactionDetails.qty,
                          baseRatio: transactionDetails.baseRatio,
                          weight: productDetails.weight,
                          length: productDetails.length,
                          width: productDetails.width,
                          height: productDetails.height,
                      })
                      .from(transactionDetails)
                      .innerJoin(
                          productDetails,
                          eq(
                              productDetails.id,
                              transactionDetails.productDetailId,
                          ),
                      )
                      .where(
                          inArray(
                              transactionDetails.transactionId,
                              assignedTxIds,
                          ),
                      )
                : [];

        const invoiceMetrics: Record<
            string,
            { totalWeight: number; totalVolume: number }
        > = {};
        for (const d of details) {
            const baseQty = Number(d.qty) * Number(d.baseRatio);
            const w = Number(d.weight || 0) * baseQty;
            const vol =
                Number(d.length || 0) *
                Number(d.width || 0) *
                Number(d.height || 0) *
                baseQty;

            if (!invoiceMetrics[d.transactionId]) {
                invoiceMetrics[d.transactionId] = {
                    totalWeight: 0,
                    totalVolume: 0,
                };
            }
            invoiceMetrics[d.transactionId].totalWeight += w;
            invoiceMetrics[d.transactionId].totalVolume += vol;
        }

        const enrichedItems = assignedInvoiceItems.map((item) => ({
            ...item,
            totalWeight: Number(
                (invoiceMetrics[item.id]?.totalWeight || 0).toFixed(2),
            ),
            totalVolume: Number(
                (invoiceMetrics[item.id]?.totalVolume || 0).toFixed(3),
            ),
        }));

        const result = activeDeliveries.map((delivery) => {
            const items = enrichedItems.filter(
                (item) => item.deliveryId === delivery.id,
            );
            const totalAssignedWeight = items.reduce(
                (sum, i) => sum + i.totalWeight,
                0,
            );
            const totalAssignedVolume = items.reduce(
                (sum, i) => sum + i.totalVolume,
                0,
            );

            return {
                ...delivery,
                totalAssignedWeight: Number(totalAssignedWeight.toFixed(2)),
                totalAssignedVolume: Number(totalAssignedVolume.toFixed(3)),
                invoices: items,
            };
        });

        return res.status(200).json({ date: targetDate, deliveries: result });
    } catch (error) {
        console.error("Error fetching dispatch board:", error);
        return res
            .status(500)
            .json({ message: "Failed to fetch dispatch board" });
    }
};

export const getPaginatedDispatches = async (req: Request, res: Response) => {
    try {
        const { pageSize, offset, search, from, to } = parseTableQuery(
            req.query as any,
        );

        const conditions: any[] = [];

        if (search) {
            conditions.push(
                or(
                    like(deliveries.loadNumber, `%${search}%`),
                    like(drivers.name, `%${search}%`),
                    like(trucks.name, `%${search}%`),
                    like(trucks.licensePlate, `%${search}%`),
                ),
            );
        }

        if (from && to) {
            const fromStr = from.toISOString().split("T")[0];
            const toStr = to.toISOString().split("T")[0];
            conditions.push(
                gte(deliveries.deliveryDate, fromStr),
                lte(deliveries.deliveryDate, toStr),
            );
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const countResult = await db
            .select({ count: sql<number>`count(*)` })
            .from(deliveries)
            .innerJoin(drivers, eq(drivers.id, deliveries.driverId))
            .innerJoin(trucks, eq(trucks.id, deliveries.truckId))
            .where(whereClause);

        const rowCount = Number(countResult[0]?.count || 0);

        const rows = await db
            .select({
                id: deliveries.id,
                loadNumber: deliveries.loadNumber,
                deliveryDate: deliveries.deliveryDate,
                driverId: deliveries.driverId,
                driverName: drivers.name,
                driverColor: drivers.color,
                truckId: deliveries.truckId,
                truckName: trucks.name,
                truckPlate: trucks.licensePlate,
                status: deliveries.status,
                notes: deliveries.notes,
                createdAt: deliveries.createdAt,
            })
            .from(deliveries)
            .innerJoin(drivers, eq(drivers.id, deliveries.driverId))
            .innerJoin(trucks, eq(trucks.id, deliveries.truckId))
            .where(whereClause)
            .orderBy(desc(deliveries.deliveryDate), desc(deliveries.createdAt))
            .limit(pageSize)
            .offset(offset);

        // Enhance rows with total invoice count
        const deliveryIds = rows.map((r) => r.id);
        let itemsCounts: Record<string, number> = {};

        if (deliveryIds.length > 0) {
            const counts = await db
                .select({
                    deliveryId: deliveryItems.deliveryId,
                    count: sql<number>`count(*)`,
                })
                .from(deliveryItems)
                .where(inArray(deliveryItems.deliveryId, deliveryIds))
                .groupBy(deliveryItems.deliveryId);

            counts.forEach((c) => {
                itemsCounts[c.deliveryId] = Number(c.count);
            });
        }

        const enrichedRows = rows.map((r) => ({
            ...r,
            totalInvoices: itemsCounts[r.id] || 0,
        }));

        return res.status(200).json({
            rows: enrichedRows,
            rowCount,
            pageCount: Math.ceil(rowCount / pageSize),
        });
    } catch (error) {
        console.error("Error fetching paginated dispatches:", error);
        return res
            .status(500)
            .json({ message: "Failed to fetch delivery dispatches" });
    }
};

export const saveDispatch = async (req: Request, res: Response) => {
    try {
        const { date, assignments } = req.body;

        if (!date || !Array.isArray(assignments)) {
            return res
                .status(400)
                .json({ message: "Invalid date or assignments data" });
        }

        let batchIndex = 1;

        for (const assign of assignments) {
            const { driverId, truckId, transactionIds = [], loadNumber: customLoadNumber } = assign;
            let deliveryId = assign.deliveryId;

            // Fetch Driver & Truck details for load number formatting
            const driverRow = await db
                .select({ name: drivers.name })
                .from(drivers)
                .where(eq(drivers.id, driverId));
            const truckRow = await db
                .select({ licensePlate: trucks.licensePlate })
                .from(trucks)
                .where(eq(trucks.id, truckId));

            const driverName = driverRow[0]?.name || "Driver";
            const licensePlate = truckRow[0]?.licensePlate || "Truck";

            // Format: ${driver_name}/${license_plate} ${delivery_date} #${batch_delivery}
            const autoLoadNumber = customLoadNumber || `${driverName}/${licensePlate} ${date} #${batchIndex++}`;

            if (!deliveryId) {
                const existing = await db
                    .select({ id: deliveries.id })
                    .from(deliveries)
                    .where(
                        and(
                            eq(deliveries.deliveryDate, date),
                            eq(deliveries.driverId, driverId),
                        ),
                    );

                if (existing.length > 0) {
                    deliveryId = existing[0].id;
                    await db
                        .update(deliveries)
                        .set({ truckId, loadNumber: autoLoadNumber })
                        .where(eq(deliveries.id, deliveryId));
                } else {
                    const [created] = await db
                        .insert(deliveries)
                        .values({
                            loadNumber: autoLoadNumber,
                            deliveryDate: date,
                            driverId,
                            truckId,
                            status: "dispatched",
                        })
                        .returning();
                    deliveryId = created.id;
                }
            } else {
                await db
                    .update(deliveries)
                    .set({ truckId, loadNumber: autoLoadNumber })
                    .where(eq(deliveries.id, deliveryId));
            }

            await db
                .delete(deliveryItems)
                .where(eq(deliveryItems.deliveryId, deliveryId));

            if (transactionIds.length > 0) {
                const newItems = transactionIds.map(
                    (txId: string, index: number) => ({
                        deliveryId,
                        transactionId: txId,
                        sequence: index + 1,
                    }),
                );
                await db.insert(deliveryItems).values(newItems);
            }
        }

        return res
            .status(200)
            .json({ message: "Dispatch route saved successfully" });
    } catch (error) {
        console.error("Error saving dispatch:", error);
        return res.status(500).json({ message: "Failed to save dispatch" });
    }
};

export const deleteDispatch = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        await db.delete(deliveryItems).where(eq(deliveryItems.deliveryId, id));
        await db.delete(deliveries).where(eq(deliveries.id, id));
        return res.status(200).json({ message: "Delivery dispatch deleted successfully" });
    } catch (error) {
        console.error("Error deleting dispatch:", error);
        return res.status(500).json({ message: "Failed to delete delivery dispatch" });
    }
};

export const getBatchPrintData = async (req: Request, res: Response) => {
    try {
        const { deliveryId } = req.params;

        const deliveryRows = await db
            .select({
                id: deliveries.id,
                loadNumber: deliveries.loadNumber,
                deliveryDate: deliveries.deliveryDate,
                status: deliveries.status,
                driverName: drivers.name,
                driverColor: drivers.color,
                truckName: trucks.name,
                truckPlate: trucks.licensePlate,
            })
            .from(deliveries)
            .innerJoin(drivers, eq(drivers.id, deliveries.driverId))
            .innerJoin(trucks, eq(trucks.id, deliveries.truckId))
            .where(eq(deliveries.id, deliveryId));

        if (deliveryRows.length === 0) {
            return res.status(404).json({ message: "Delivery route not found" });
        }

        const delivery = deliveryRows[0];

        const items = await db
            .select({
                sequence: deliveryItems.sequence,
                invoiceId: transactions.id,
                invoice: transactions.invoice,
                date: transactions.date,
                totalAmount: transactions.totalAmount,
                subtotal: transactions.subtotal,
                totalDiscount: transactions.totalDiscount,
                totalTax: transactions.totalTax,
                customerName: contacts.name,
                customerAddress: contacts.address,
                customerPhone: contacts.phone,
                routeGroupName: routeGroups.name,
            })
            .from(deliveryItems)
            .innerJoin(
                transactions,
                eq(transactions.id, deliveryItems.transactionId),
            )
            .innerJoin(contacts, eq(contacts.id, transactions.contactId))
            .leftJoin(routeGroups, eq(routeGroups.id, contacts.routeGroupId))
            .where(eq(deliveryItems.deliveryId, deliveryId))
            .orderBy(deliveryItems.sequence);

        const invoiceIds = items.map((i) => i.invoiceId);
        let lineItems: any[] = [];
        if (invoiceIds.length > 0) {
            lineItems = await db
                .select({
                    transactionId: transactionDetails.transactionId,
                    qty: transactionDetails.qty,
                    price: transactionDetails.price,
                    discount: transactionDetails.discount,
                    amount: transactionDetails.amount,
                    productName: products.name,
                    productCode: productDetails.skuId,
                    unitName: productUnits.name,
                })
                .from(transactionDetails)
                .innerJoin(
                    productDetails,
                    eq(productDetails.id, transactionDetails.productDetailId),
                )
                .innerJoin(products, eq(products.id, productDetails.productId))
                .innerJoin(productUnits, eq(productUnits.id, productDetails.unitId))
                .where(inArray(transactionDetails.transactionId, invoiceIds));
        }

        const invoicesWithDetails = items.map((inv) => ({
            ...inv,
            details: lineItems.filter((l) => l.transactionId === inv.invoiceId),
        }));

        return res.status(200).json({
            delivery,
            invoices: invoicesWithDetails,
        });
    } catch (error) {
        console.error("Error fetching batch print data:", error);
        return res
            .status(500)
            .json({ message: "Failed to fetch batch print data" });
    }
};
