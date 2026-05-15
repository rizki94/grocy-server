import { db } from "@/db";
import {
    accountMappings,
    contacts,
    journalEntries,
    journals,
    openInvoices,
    transactionDetails,
    transactions,
} from "@/db/schemas";
import { addDays } from "@/helpers/add-days";
import { generateInvoice } from "@/helpers/generate-invoice";
import { logAction } from "@/utils/log-helper";
import { updateStockForTransaction } from "@/repositories/stock.repository";
import { purchaseById } from "@/repositories/transaction.repository";
import { CacheService } from "@/services/cache-service";
import {
    transactionWithDetailInsertSchema,
    transactionWithDetailUpdateSchema,
} from "@/validators/transaction.validator";
import {
    and,
    asc,
    desc,
    eq,
    gte,
    inArray,
    like,
    lte,
    or,
    sql,
} from "drizzle-orm";
import { PgColumn } from "drizzle-orm/pg-core";
import { Request, Response } from "express";
import { findGlAccountByCode } from "@/repositories/gl-account.repository";
import { parseTableQuery } from "@/services/table-query";

export async function getAllSalesReturns(req: Request, res: Response) {
    try {
        const data = await CacheService.getOrSet(
            "sales_returns:all",
            60,
            async () => {
                return db
                    .select()
                    .from(transactions)
                    .where(and(eq(transactions.type, "sales_return")))
                    .orderBy(transactions.invoice);
            },
        );
        res.status(200).json(data);
    } catch (error) {
        console.error("Error fetching sales:", error);
        res.status(500).json({ message: "Failed to fetch sales" });
    }
}

export const getSalesReturnById = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        const rows = await purchaseById(id); // Reusing generic transaction fetcher

        if (rows.length === 0) {
            return res
                .status(404)
                .json({ error: "Sales transaction not found" });
        }

        const { transaction } = rows[0];
        const details = rows.filter((r) => r.detail).map((r) => r.detail!);

        let parent = null;
        if (transaction.parentId) {
            parent = await db
                .select({ invoice: transactions.invoice })
                .from(transactions)
                .where(eq(transactions.id, transaction.parentId))
                .then((r) => r[0]);
        }

        res.status(200).json({ ...transaction, details, parent });
    } catch (error) {
        console.error("Error fetching sales transaction:", error);
        res.status(500).json({
            message: "Failed to fetch sales transaction",
        });
    }
};

export const createSalesReturn = async (req: Request, res: Response) => {
    const parsed = transactionWithDetailInsertSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    const { details, ...salesData } = parsed.data;
    const invoice = await generateInvoice("sales_return");

    try {
        const [createdSales] = await db
            .insert(transactions)
            .values({
                ...salesData,
                invoice,
                type: "sales_return",
                status: "order",
                userId: req.user!.id,
            })
            .returning();

        for (const detail of details) {
            await db
                .insert(transactionDetails)
                .values({
                    transactionId: createdSales.id,
                    ...detail,
                    movementType: 1, // IN
                })
                .returning();
        }

        logAction(req, {
            action: "update",
            table: "transactions",
            data: {
                transaction: createdSales,
                details: details,
            },
            userId: req.user!.id,
            msg: `created sales #${createdSales.id}`,
        });

        const rows = await purchaseById(createdSales.id);
        const { transaction } = rows[0];
        const responseDetails = rows.filter((r) => r.detail).map((r) => r.detail!);

        return res.status(201).json({
            message: "Sales created successfully",
            sales: { ...transaction, details: responseDetails },
        });
    } catch (error) {
        console.error("Create sales error:", error);
        return res
            .status(500)
            .json({ message: "Failed to create sales", error });
    }
};

export const updateSalesReturn = async (req: Request, res: Response) => {
    const parsed = transactionWithDetailUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    const sales = parsed.data;

    if (!sales.id)
        return res.status(400).json({ message: "Sales id is required" });

    try {
        const oldSales = await db
            .select()
            .from(transactions)
            .where(eq(transactions.id, parsed.data.id))
            .then((r) => r[0]);

        if (!oldSales)
            return res.status(404).json({ message: "Sales not found" });

        const [updatedSales] = await db
            .update(transactions)
            .set(sales)
            .where(eq(transactions.id, sales.id))
            .returning();

        const existingDetails = await db
            .select()
            .from(transactionDetails)
            .where(eq(transactionDetails.transactionId, sales.id));

        const incomingDetailIds = sales.details
            .map((d) => d.id)
            .filter((id): id is string => !!id);

        const toDeleteDetails = existingDetails.filter(
            (d) => !incomingDetailIds.includes(d.id!),
        );
        if (toDeleteDetails.length > 0) {
            await db.delete(transactionDetails).where(
                inArray(
                    transactionDetails.id,
                    toDeleteDetails.map((d) => d.id!),
                ),
            );
        }

        for (const detail of sales.details) {
            if (detail.id) {
                await db
                    .update(transactionDetails)
                    .set(detail)
                    .where(eq(transactionDetails.id, detail.id));
            } else {
                const [insertedDetail] = await db
                    .insert(transactionDetails)
                    .values({
                        transactionId: updatedSales.id,
                        ...detail,
                        movementType: 1, // IN
                    })
                    .returning();
                detail.id = insertedDetail.id;
            }
        }

        logAction(req, {
            action: "update",
            table: "transactions",
            oldData: {
                transaction: oldSales,
                details: existingDetails,
            },
            data: {
                transaction: updatedSales,
                details: sales.details,
            },
            userId: req.user!.id,
            msg: `updated sales #${updatedSales.id}`,
        });

        return res.status(200).json({
            message: "Sales updated successfully",
            sales: updatedSales,
        });
    } catch (error) {
        console.error("Update sales error:", error);
        return res
            .status(500)
            .json({ message: "Failed to update sales", error });
    }
};

export const postSalesReturn = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        await db.transaction(async (tx) => {
            const [sales] = await tx
                .update(transactions)
                .set({ status: "posted" })
                .where(eq(transactions.id, id))
                .returning();

            if (!sales) {
                return res.status(404).json({ message: "Sales not found" });
            }

            const details = await tx
                .select()
                .from(transactionDetails)
                .where(eq(transactionDetails.transactionId, id));

            if (!details.length) {
                return res
                    .status(400)
                    .json({ message: "Sales has no details" });
            }

            // OUT
            await updateStockForTransaction(id, "sales_return", details);

            const total = details.reduce(
                (sum, d) => sum + Number(d.qty) * Number(d.price),
                0,
            );

            // Fetch metrics for Sales
            const mappings = await tx
                .select()
                .from(accountMappings)
                .where(eq(accountMappings.type, "sales_return"));

            const [journal] = await tx
                .insert(journals)
                .values({
                    transactionId: sales.id,
                    date: sales.date,
                    description: `Retur Penjualan ${sales.invoice}`,
                    status: "posted",
                })
                .returning();

            for (const map of mappings) {
                await tx.insert(journalEntries).values({
                    journalId: journal.id,
                    glAccountId: await findGlAccountByCode(map.glAccountCode),
                    debit: map.side === "debit" ? Number(sales.totalAmount) : 0,
                    credit:
                        map.side === "credit" ? Number(sales.totalAmount) : 0,
                    note: `${map.note} ${sales.invoice}`,
                });
            }

            // Receivable for Sales Return (Credit Note)
            await tx.insert(openInvoices).values({
                transactionId: sales.id,
                contactId: sales.contactId,
                type: "receivable",
                dueDate: addDays(sales.date, sales.termOfPayment),
                amount: -Number(sales.totalAmount),
                paidAmount: 0,
                status: "open",
            });

            logAction(req, {
                action: "update",
                table: "transactions",
                data: sales,
                userId: req.user!.id,
                msg: `posted sales return #${sales.id}`,
            });

            return res.status(200).json({
                message: "Sales posted successfully",
                sales: sales,
            });
        });
    } catch (error: any) {
        console.error("Post sales error:", error);
        return res
            .status(error instanceof Error ? 400 : 500)
            .json({ message: error.message || "Failed to post sales", error });
    }
};

export const getPaginatedSalesReturns = async (req: Request, res: Response) => {
    try {
        const {
            search,
            sort,
            order,
            select,
            pageIndex,
            pageSize,
            offset,
            from,
            to,
        } = parseTableQuery(req.query);

        const searchCondition = search
            ? or(
                like(
                    sql`LOWER(${transactions.invoice})`,
                    `%${search.toLowerCase()}%`,
                ),
                like(
                    sql`LOWER(${contacts.name})`,
                    `%${search.toLowerCase()}%`,
                ),
            )
            : undefined;

        const filterCondition = select
            ? eq(transactions.status, sql`${select}`)
            : undefined;

        const dateCondition =
            from && to
                ? and(
                    gte(transactions.date, from.toISOString()),
                    lte(transactions.date, to.toISOString()),
                )
                : from
                    ? gte(transactions.date, from.toISOString())
                    : to
                        ? lte(transactions.date, to.toISOString())
                        : undefined;

        const sortColumns: Record<string, PgColumn> = {
            invoice: transactions.invoice,
        };

        const sortColumn = sortColumns[sort] ?? transactions.invoice;

        const [salesList, [totalCount]] = await Promise.all([
            db
                .select({
                    id: transactions.id,
                    invoice: transactions.invoice,
                    customer: contacts.name, // Changed from supplier to customer
                    status: transactions.status,
                    totalAmount: transactions.totalAmount,
                    date: transactions.date,
                    parentId: transactions.parentId,
                })
                .from(transactions)
                .innerJoin(contacts, eq(contacts.id, transactions.contactId))
                .where(
                    and(
                        eq(transactions.type, "sales_return"), // Filter by type
                        searchCondition,
                        filterCondition,
                        dateCondition,
                    ),
                )
                .orderBy(order === "desc" ? desc(sortColumn) : asc(sortColumn))
                .limit(pageSize)
                .offset(offset),
            db
                .select({ count: sql<number>`count(*)` })
                .from(transactions)
                .innerJoin(contacts, eq(contacts.id, transactions.contactId))
                .where(
                    and(
                        eq(transactions.type, "sales_return"), // Filter by type
                        searchCondition,
                        filterCondition,
                        dateCondition,
                    ),
                ),
        ]);

        res.json({
            rows: salesList,
            pageCount: Math.ceil(Number(totalCount?.count || 0) / pageSize),
            rowCount: Number(totalCount?.count || 0),
            pageIndex,
            pageSize,
            sort,
            order,
        });
    } catch (error) {
        console.error("Error fetching sales:", error);
        res.status(500).json({ message: "Failed to fetch sales" });
    }
};
export const cancelSalesReturn = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        await db.transaction(async (tx) => {
            // 1. Get Original Return
            const originalRows = await purchaseById(id);
            if (originalRows.length === 0) {
                return res.status(404).json({ message: "Sales return not found" });
            }

            const original = originalRows[0].transaction;
            const originalDetails = originalRows
                .filter((r) => r.detail)
                .map((r) => r.detail!);

            if (original.status === "cancelled") {
                return res
                    .status(400)
                    .json({ message: "Return is already cancelled" });
            }

            // 2. Create Reversal Transaction
            const [reversal] = await tx
                .insert(transactions)
                .values({
                    invoice: `${original.invoice}-VOID`,
                    type: "sales_return",
                    reference: `Void of ${original.invoice}`,
                    contactId: original.contactId,
                    termOfPayment: original.termOfPayment,
                    date: new Date().toISOString(),
                    status: "cancelled",
                    parentId: original.id,
                    updatedAt: new Date(),
                    subtotal: -Number(original.subtotal),
                    totalDiscount: -Number(original.totalDiscount),
                    totalTax: -Number(original.totalTax || 0),
                    totalAmount: -Number(original.totalAmount),
                    userId: req.user!.id,
                })
                .returning();

            // 3. Create Reversed Details (Negative Qty/Amount, Invert Movement)
            const reversedDetails = originalDetails.map((detail) => ({
                transactionId: reversal.id,
                productId: detail.productId,
                productDetailId: detail.productDetailId,
                baseRatio: detail.baseRatio,
                qty: -Number(detail.qty),
                price: detail.price,
                discount: -Number(detail.discount),
                amount: -Number(detail.amount),
                taxRate: detail.taxRate,
                unitCost: detail.unitCost,
                totalCost: -Number(detail.totalCost || 0),
                movementType: -1, // OUT (Original was IN)
            }));

            // Insert Reversed Details
            for (const detail of reversedDetails) {
                await tx.insert(transactionDetails).values(detail);
            }

            // 4. Update Stock (Only if original was posted)
            if (original.status === "posted" || original.status === "paid") {
                await updateStockForTransaction(
                    reversal.id,
                    "sales_return",
                    reversedDetails.map((d) => ({
                        ...d,
                        qty: Math.abs(d.qty),
                    })) as any,
                    tx
                );

                // 5. Create Reversal Journal
                const [journal] = await tx
                    .insert(journals)
                    .values({
                        transactionId: reversal.id,
                        date: reversal.date,
                        description: `Void Sales Return #${original.invoice}`,
                        status: "posted",
                    })
                    .returning();

                // Get original mappings to reverse them
                const mappings = await tx
                    .select()
                    .from(accountMappings)
                    .where(eq(accountMappings.type, "sales_return"));

                for (const map of mappings) {
                    await tx.insert(journalEntries).values({
                        journalId: journal.id,
                        glAccountId: await findGlAccountByCode(map.glAccountCode),
                        debit:
                            map.side === "debit"
                                ? -Number(original.totalAmount)
                                : 0,
                        credit:
                            map.side === "credit"
                                ? -Number(original.totalAmount)
                                : 0,
                        note: `Void ${map.note} ${original.invoice}`,
                    });
                }

                // 6. Reverse Open Invoices (Add positive amount to cancel negative one)
                await tx.insert(openInvoices).values({
                    transactionId: reversal.id,
                    contactId: original.contactId,
                    type: "receivable",
                    dueDate: addDays(original.date, original.termOfPayment),
                    amount: Number(original.totalAmount), // Positive to offset original negative
                    paidAmount: 0,
                    status: "open",
                });
            }

            // 7. Mark original as cancelled
            await tx
                .update(transactions)
                .set({ status: "cancelled" })
                .where(eq(transactions.id, id));

            logAction(req, {
                action: "update",
                table: "transactions",
                data: reversal,
                userId: req.user!.id,
                msg: `voided sales return #${original.invoice}`,
            });

            return res.status(200).json({
                message: "Sales return voided successfully",
                reversal: reversal,
            });
        });
    } catch (error: any) {
        console.error("Void sales return error:", error);
        return res.status(500).json({
            message: error.message || "Failed to void sales return",
            error,
        });
    }
};
