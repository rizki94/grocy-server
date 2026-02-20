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

export async function getAllSales(req: Request, res: Response) {
    try {
        const data = await CacheService.getOrSet("sales:all", 60, async () => {
            return db
                .select()
                .from(transactions)
                .where(eq(transactions.type, "sales"))
                .orderBy(transactions.invoice);
        });
        res.status(200).json(data);
    } catch (error) {
        console.error("Error fetching sales:", error);
        res.status(500).json({ message: "Failed to fetch sales" });
    }
}

export const getSalesById = async (req: Request, res: Response) => {
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

        res.status(200).json({ ...transaction, details });
    } catch (error) {
        console.error("Error fetching sales transaction:", error);
        res.status(500).json({
            message: "Failed to fetch sales transaction",
        });
    }
};

export const createSales = async (req: Request, res: Response) => {
    const parsed = transactionWithDetailInsertSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    const sales = parsed.data;
    const invoice = await generateInvoice("sales");

    try {
        const [createdSales] = await db
            .insert(transactions)
            .values({
                ...sales,
                invoice,
                type: "sales",
                status: "order",
                userId: req.user!.id,
            })
            .returning();

        for (const detail of sales.details) {
            await db
                .insert(transactionDetails)
                .values({
                    transactionId: createdSales.id,
                    ...detail,
                    movementType: -1, // OUT
                })
                .returning();
        }

        logAction(req, {
            action: "update",
            table: "transactions",
            data: {
                transaction: createdSales,
                details: sales.details,
            },
            userId: req.user!.id,
            msg: `created sales #${createdSales.id}`,
        });

        const rows = await purchaseById(createdSales.id);
        const { transaction } = rows[0];
        const details = rows.filter((r) => r.detail).map((r) => r.detail!);

        return res.status(201).json({
            message: "Sales created successfully",
            sales: { ...transaction, details },
        });
    } catch (error) {
        console.error("Create sales error:", error);
        return res
            .status(500)
            .json({ message: "Failed to create sales", error });
    }
};

export const updateSales = async (req: Request, res: Response) => {
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

        if (oldSales.status === "posted" || oldSales.status === "paid") {
            return res.status(400).json({
                message: "Cannot edit a posted or paid sales transaction",
            });
        }

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
                        movementType: -1, // OUT
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

export const postSales = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        let postedSales: any;

        await db.transaction(async (tx) => {
            // Guard: check current status first
            const [existing] = await tx
                .select()
                .from(transactions)
                .where(eq(transactions.id, id));

            if (!existing) throw new Error("Sales not found");
            if (existing.status !== "draft" && existing.status !== "order") {
                throw new Error(
                    `Sales is already ${existing.status} and cannot be posted again`,
                );
            }

            // Guard: check no journal already exists for this transaction
            const [existingJournal] = await tx
                .select()
                .from(journals)
                .where(eq(journals.transactionId, id));

            if (existingJournal) {
                throw new Error(
                    "A journal has already been posted for this sales transaction",
                );
            }

            const [sales] = await tx
                .update(transactions)
                .set({ status: "posted" })
                .where(eq(transactions.id, id))
                .returning();

            if (!sales) {
                throw new Error("Sales not found");
            }

            const details = await tx
                .select()
                .from(transactionDetails)
                .where(eq(transactionDetails.transactionId, id));

            if (!details.length) {
                throw new Error("Sales has no details");
            }

            // OUT
            await updateStockForTransaction(id, "sales", details);

            // Fetch metrics for Sales
            const mappings = await tx
                .select()
                .from(accountMappings)
                .where(eq(accountMappings.type, "sales"));

            const [journal] = await tx
                .insert(journals)
                .values({
                    transactionId: sales.id,
                    date: sales.date,
                    description: `Posting penjualan #${sales.invoice}`,
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
                    note: map.note,
                });
            }

            // COGS and Inventory
            const detailsWithCost = await tx
                .select()
                .from(transactionDetails)
                .where(eq(transactionDetails.transactionId, id));

            const totalCogs = detailsWithCost.reduce(
                (sum, d) => sum + Number(d.totalCost || 0),
                0,
            );

            if (totalCogs > 0) {
                await tx.insert(journalEntries).values({
                    journalId: journal.id,
                    glAccountId: await findGlAccountByCode("5100"),
                    debit: totalCogs,
                    credit: 0,
                    note: `COGS for #${sales.invoice}`,
                });
                await tx.insert(journalEntries).values({
                    journalId: journal.id,
                    glAccountId: await findGlAccountByCode("1400"),
                    debit: 0,
                    credit: totalCogs,
                    note: `Inventory reduction for #${sales.invoice}`,
                });
            }

            // Receivable for Sales
            await tx.insert(openInvoices).values({
                transactionId: sales.id,
                contactId: sales.contactId,
                type: "receivable",
                dueDate: addDays(sales.date, sales.termOfPayment),
                amount: Number(sales.totalAmount),
                paidAmount: 0,
                status: "open",
            });

            postedSales = sales;

            logAction(req, {
                action: "update",
                table: "transactions",
                data: sales,
                userId: req.user!.id,
                msg: `posted sales #${sales.id}`,
            });
        });

        // Response is sent AFTER transaction commits to avoid race condition
        return res.status(200).json({
            message: "Sales posted successfully",
            sales: postedSales,
        });
    } catch (error: any) {
        console.error("Post sales error:", error);
        return res
            .status(error instanceof Error ? 400 : 500)
            .json({ message: error.message || "Failed to post sales", error });
    }
};

export const getPaginatedSales = async (req: Request, res: Response) => {
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
                })
                .from(transactions)
                .innerJoin(contacts, eq(contacts.id, transactions.contactId))
                .where(
                    and(
                        eq(transactions.type, "sales"), // Filter by type
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
                        eq(transactions.type, "sales"), // Filter by type
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

export const getPostedSalesByContact = async (req: Request, res: Response) => {
    const { contactId } = req.params;
    try {
        const data = await db
            .select({
                id: transactions.id,
                invoice: transactions.invoice,
                date: transactions.date,
                totalAmount: transactions.totalAmount,
            })
            .from(transactions)
            .where(
                and(
                    eq(transactions.contactId, contactId),
                    eq(transactions.type, "sales"),
                    or(
                        eq(transactions.status, "posted"),
                        eq(transactions.status, "paid"),
                    ),
                ),
            )
            .orderBy(desc(transactions.date));
        res.status(200).json(data);
    } catch (error) {
        console.error("Error fetching posted sales:", error);
        res.status(500).json({ message: "Failed to fetch posted sales" });
    }
};

export const cancelSales = async (req: Request, res: Response) => {
    const { id } = req.params;
    console.log(`[cancelSales] Starting for ID: ${id}`);
    try {
        await db.transaction(async (tx) => {
            // 1. Get Original Transaction
            const [original] = await tx
                .select()
                .from(transactions)
                .where(eq(transactions.id, id));

            if (!original) throw new Error("Sales not found");
            if (original.status !== "posted") {
                throw new Error("Only posted sales can be voided");
            }

            // 2. Check for Payments
            const [invoice] = await tx
                .select()
                .from(openInvoices)
                .where(eq(openInvoices.transactionId, id));

            if (invoice && Number(invoice.paidAmount) > 0) {
                throw new Error(
                    "Cannot void sales with existing payments. Void payments first.",
                );
            }

            // 3. Fetch Original Details
            const originalDetails = await tx
                .select()
                .from(transactionDetails)
                .where(eq(transactionDetails.transactionId, id));

            // 4. Create Reversal Transaction
            const reversalInvoice = await generateInvoice("sales");
            const [reversal] = await tx
                .insert(transactions)
                .values({
                    userId: req.user!.id,
                    type: "sales",
                    invoice: reversalInvoice,
                    reference: `Void of ${original.invoice}`,
                    contactId: original.contactId,
                    termOfPayment: original.termOfPayment,
                    date: new Date().toISOString(),
                    status: "posted",
                    updatedAt: new Date(),
                    totalAmount: original.totalAmount,
                })
                .returning();

            // 5. Create Reversed Details (Invert Movement Type)
            // Sales was -1 (OUT). Reversal is 1 (IN).
            const reversedDetails = originalDetails.map((detail) => ({
                ...detail,
                transactionId: reversal.id,
                movementType: 1, // IN
                // Note: For IN, unitCost is used. We should use the cost it was sold at?
                // Or leave it?
                // originalDetails has totalCost.
                // updateStockForTransaction treats IN as adding stock.
                // It uses detail.unitCost * detail.qty.
                // original detail likely has totalCost (COGS).
                // unitCost might be derived.
                // Let's ensure unitCost is correct if available.
            }));

            // Insert Reversed Details
            for (const detail of reversedDetails) {
                await tx.insert(transactionDetails).values({
                    transactionId: reversal.id,
                    productId: detail.productId,
                    productDetailId: detail.productDetailId,
                    baseRatio: detail.baseRatio,
                    qty: detail.qty,
                    price: detail.price,
                    discount: detail.discount,
                    amount: detail.amount,
                    taxRate: detail.taxRate,
                    unitCost: detail.unitCost, // Important for IN cost
                    totalCost: detail.totalCost,
                    movementType: detail.movementType,
                });
            }

            // 6. Update Stock (Process logic for Reversal - IN)
            await updateStockForTransaction(
                reversal.id,
                "sales",
                reversedDetails as any,
                tx,
            );

            // 7. Create Reversal Journal
            const [journal] = await tx
                .insert(journals)
                .values({
                    transactionId: reversal.id,
                    date: reversal.date,
                    description: `Void Sales #${original.invoice}`,
                    status: "posted",
                })
                .returning();

            // Reverse Sales Revenue / Receivable
            const mappings = await tx
                .select()
                .from(accountMappings)
                .where(eq(accountMappings.type, "sales"));

            const total = Number(original.totalAmount);

            for (const map of mappings) {
                await tx.insert(journalEntries).values({
                    journalId: journal.id,
                    glAccountId: await findGlAccountByCode(map.glAccountCode),
                    debit: map.side === "credit" ? total : 0, // Swap
                    credit: map.side === "debit" ? total : 0, // Swap
                    note: `Void ${map.note}`,
                });
            }

            // Reverse COGS / Inventory
            // Original: Dr COGS, Cr Inventory
            // Reversal: Cr COGS, Dr Inventory
            const totalCogs = originalDetails.reduce(
                (sum, d) => sum + Number(d.totalCost || 0),
                0,
            );

            if (totalCogs > 0) {
                // Dr Inventory (1400)
                await tx.insert(journalEntries).values({
                    journalId: journal.id,
                    glAccountId: await findGlAccountByCode("1400"),
                    debit: totalCogs,
                    credit: 0,
                    note: `Void Inventory reduction #${original.invoice}`,
                });
                // Cr COGS (5100)
                await tx.insert(journalEntries).values({
                    journalId: journal.id,
                    glAccountId: await findGlAccountByCode("5100"),
                    debit: 0,
                    credit: totalCogs,
                    note: `Void COGS #${original.invoice}`,
                });
            }

            // 8. Delete Original Receivable (Open Invoice)
            // This "Unposts" the AR impact.
            if (invoice) {
                await tx
                    .delete(openInvoices)
                    .where(eq(openInvoices.id, invoice.id));
            }

            // 9. Mark Original as Cancelled
            await tx
                .update(transactions)
                .set({ status: "cancelled", updatedAt: new Date() })
                .where(eq(transactions.id, id));

            console.log(`[cancelSales] Void complete.`);

            logAction(req, {
                action: "update",
                table: "transactions",
                data: original,
                userId: req.user!.id,
                msg: `voided sales #${original.id}`,
            });
        });

        res.status(200).json({ message: "Sales voided successfully" });
    } catch (error: any) {
        console.error("Void sales error:", error);
        res.status(500).json({
            message: error.message || "Failed to void sales",
        });
    }
};
