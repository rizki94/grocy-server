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
import { purchaseById, extractDetails } from "@/repositories/transaction.repository";
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
import { TransactionType } from "@/constants/transaction.constant";
import { parseTableQuery } from "@/services/table-query";

export async function getAllPurchaseReturns(req: Request, res: Response) {
    try {
        const data = await CacheService.getOrSet(
            "purchase_returns:all",
            60,
            async () => {
                return db
                    .select()
                    .from(transactions)
                    .where(and(eq(transactions.type, "purchase_return")))
                    .orderBy(transactions.invoice);
            },
        );
        res.status(200).json(data);
    } catch (error) {
        console.error("Error fetching purchases:", error);
        res.status(500).json({ message: "Failed to fetch purchases" });
    }
}

export const getPurchaseReturnById = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        const rows = await purchaseById(id);

        if (rows.length === 0) {
            return res
                .status(404)
                .json({ error: "Purchase transaction not found" });
        }

        const { transaction } = rows[0];
        const details = extractDetails(rows);

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
        console.error("Error fetching purchase transaction:", error);
        res.status(500).json({
            message: "Failed to fetch purchase transaction",
        });
    }
};

export const createPurchaseReturn = async (req: Request, res: Response) => {
    const parsed = transactionWithDetailInsertSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    const { details, ...purchaseData } = parsed.data;
    const invoice = await generateInvoice("purchase_return");

    try {
        const [createdPurchase] = await db
            .insert(transactions)
            .values({
                ...purchaseData,
                invoice,
                type: "purchase_return",
                status: "order",
                userId: req.user!.id,
            })
            .returning();

        for (const detail of details) {
            await db
                .insert(transactionDetails)
                .values({
                    transactionId: createdPurchase.id,
                    ...detail,
                    movementType: -1, // OUT
                })
                .returning();
        }

        logAction(req, {
            action: "update",
            table: "transactions",
            data: {
                transaction: createdPurchase,
                details: details,
            },
            userId: req.user!.id,
            msg: `created purchase #${createdPurchase.id}`,
        });

        const rows = await purchaseById(createdPurchase.id);
        const { transaction } = rows[0];
        const responseDetails = extractDetails(rows);

        return res.status(201).json({
            message: "Purchase created successfully",
            purchase: { ...transaction, details: responseDetails },
        });
    } catch (error) {
        console.error("Create purchase error:", error);
        return res
            .status(500)
            .json({ message: "Failed to create purchase", error });
    }
};

export const updatePurchaseReturn = async (req: Request, res: Response) => {
    const parsed = transactionWithDetailUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    const purchase = parsed.data;

    if (!purchase.id)
        return res.status(400).json({ message: "Purchase id is required" });

    try {
        const oldPurchase = await db
            .select()
            .from(transactions)
            .where(eq(transactions.id, parsed.data.id))
            .then((r) => r[0]);

        if (!oldPurchase)
            return res.status(404).json({ message: "Purchase not found" });

        const [updatedPurchase] = await db
            .update(transactions)
            .set(purchase)
            .where(eq(transactions.id, purchase.id))
            .returning();

        const existingDetails = await db
            .select()
            .from(transactionDetails)
            .where(eq(transactionDetails.transactionId, purchase.id));

        const incomingDetailIds = purchase.details
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

        for (const detail of purchase.details) {
            if (detail.id) {
                await db
                    .update(transactionDetails)
                    .set(detail)
                    .where(eq(transactionDetails.id, detail.id));
            } else {
                const [insertedDetail] = await db
                    .insert(transactionDetails)
                    .values({
                        transactionId: updatedPurchase.id,
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
                transaction: oldPurchase,
                details: existingDetails,
            },
            data: {
                transaction: updatedPurchase,
                details: purchase.details,
            },
            userId: req.user!.id,
            msg: `updated purchase #${updatedPurchase.id}`,
        });

        return res.status(200).json({
            message: "Purchase updated successfully",
            purchase: updatedPurchase,
        });
    } catch (error) {
        console.error("Update purchase error:", error);
        return res
            .status(500)
            .json({ message: "Failed to update purchase", error });
    }
};

export const postPurchaseReturn = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        await db.transaction(async (tx) => {
            const [existing] = await tx
                .select()
                .from(transactions)
                .where(eq(transactions.id, id));

            if (!existing) throw new Error("Purchase return not found");
            if (existing.status !== "draft" && existing.status !== "order") {
                throw new Error(
                    `Purchase return is already ${existing.status} and cannot be posted again`,
                );
            }

            const [existingJournal] = await tx
                .select()
                .from(journals)
                .where(eq(journals.transactionId, id));

            if (existingJournal) {
                throw new Error(
                    "A journal has already been posted for this purchase return transaction",
                );
            }

            const [purchase] = await tx
                .update(transactions)
                .set({ status: "posted" })
                .where(eq(transactions.id, id))
                .returning();

            if (!purchase) {
                throw new Error("Purchase return not found");
            }

            const details = await tx
                .select()
                .from(transactionDetails)
                .where(eq(transactionDetails.transactionId, id));

            if (!details.length) {
                throw new Error("Purchase return has no details");
            }

            // Update Stock (OUT)
            await updateStockForTransaction(id, "purchase_return", details);

            // Calculate subtotal, tax, and total amount
            let calcSubtotal = Number(purchase.subtotal || 0);
            let calcTax = Number(purchase.totalTax || 0);
            let calcDiscount = Number(purchase.totalDiscount || 0);

            if (calcTax === 0) {
                calcTax = details.reduce((sum, d) => {
                    const linePrice = Number(d.qty || 0) * Number(d.price || 0) - Number(d.discount || 0);
                    return sum + linePrice * (Number(d.taxRate || 0) / 100);
                }, 0);
            }

            if (calcSubtotal === 0) {
                calcSubtotal = details.reduce((sum, d) => sum + Number(d.qty || 0) * Number(d.price || 0), 0);
            }

            const netCost = calcSubtotal - calcDiscount;
            const calcAmount = Number(purchase.totalAmount || (netCost + calcTax));

            const [journal] = await tx
                .insert(journals)
                .values({
                    transactionId: purchase.id,
                    date: purchase.date,
                    description: `Retur Pembelian ${purchase.invoice}`,
                    status: "posted",
                })
                .returning();

            // Dynamic GL Account lookup based on account_mappings
            const purchaseMapping = await tx.select().from(accountMappings).where(eq(accountMappings.type, "purchase"));
            const taxMapping = await tx.select().from(accountMappings).where(eq(accountMappings.type, "purchase_tax"));

            const inventoryGlCode = purchaseMapping.find((m) => m.side === "debit")?.glAccountCode || "1400";
            const apGlCode = purchaseMapping.find((m) => m.side === "credit")?.glAccountCode || "2100";
            const taxGlCode = taxMapping[0]?.glAccountCode || "1500";

            const apGl = (await findGlAccountByCode(apGlCode)) || (await findGlAccountByCode("2100"));
            const inventoryGl = (await findGlAccountByCode(inventoryGlCode)) || (await findGlAccountByCode("1400"));
            const taxGl = (await findGlAccountByCode(taxGlCode)) || (await findGlAccountByCode("1500")) || (await findGlAccountByCode("1450"));

            if (calcAmount > 0 && apGl) {
                await tx.insert(journalEntries).values({
                    journalId: journal.id,
                    glAccountId: apGl,
                    debit: calcAmount,
                    credit: 0,
                    note: `Hutang Retur Pembelian ${purchase.invoice}`,
                });
            }

            if (netCost > 0 && inventoryGl) {
                await tx.insert(journalEntries).values({
                    journalId: journal.id,
                    glAccountId: inventoryGl,
                    debit: 0,
                    credit: netCost,
                    note: `Persediaan Retur Pembelian ${purchase.invoice}`,
                });
            }

            if (calcTax > 0 && taxGl) {
                await tx.insert(journalEntries).values({
                    journalId: journal.id,
                    glAccountId: taxGl,
                    debit: 0,
                    credit: calcTax,
                    note: `PPN Masukan Retur Pembelian ${purchase.invoice}`,
                });
            }


            // Payable for Purchase Return (Debit Note)
            await tx.insert(openInvoices).values({
                transactionId: purchase.id,
                contactId: purchase.contactId,
                type: "payable",
                dueDate: addDays(purchase.date, purchase.termOfPayment),
                amount: -calcAmount,
                paidAmount: 0,
                status: "open",
            });


            logAction(req, {
                action: "update",
                table: "transactions",
                data: purchase,
                userId: req.user!.id,
                msg: `posted purchase return #${purchase.id}`,
            });

            return res.status(200).json({
                message: "Purchase return posted successfully",
                purchase: purchase,
            });
        });
    } catch (error: any) {
        console.error("Post purchase return error:", error);
        return res.status(error instanceof Error ? 400 : 500).json({
            message: error.message || "Failed to post purchase return",
            error,
        });
    }
};


export const getPaginatedPurchaseReturns = async (
    req: Request,
    res: Response,
) => {
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

        const [purchaseList, [totalCount]] = await Promise.all([
            db
                .select({
                    id: transactions.id,
                    invoice: transactions.invoice,
                    supplier: contacts.name,
                    status: transactions.status,
                    totalAmount: transactions.totalAmount,
                    date: transactions.date,
                    parentId: transactions.parentId,
                })
                .from(transactions)
                .innerJoin(contacts, eq(contacts.id, transactions.contactId))
                .where(
                    and(
                        eq(transactions.type, "purchase_return"),
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
                        eq(transactions.type, "purchase_return"),
                        searchCondition,
                        filterCondition,
                        dateCondition,
                    ),
                ),
        ]);

        res.json({
            rows: purchaseList,
            pageCount: Math.ceil(Number(totalCount?.count || 0) / pageSize),
            rowCount: Number(totalCount?.count || 0),
            pageIndex,
            pageSize,
            sort,
            order,
        });
    } catch (error) {
        console.error("Error fetching purchases:", error);
        res.status(500).json({ message: "Failed to fetch purchases" });
    }
};

export const cancelPurchaseReturn = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        await db.transaction(async (tx) => {
            // 1. Get Original Return
            const originalRows = await purchaseById(id);
            if (originalRows.length === 0) {
                return res
                    .status(404)
                    .json({ message: "Purchase return not found" });
            }

            const original = originalRows[0].transaction;
            const originalDetails = originalRows
                .filter((r) => r.detail?.id != null)
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
                    type: "purchase_return",
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
                movementType: 1, // IN (Original was OUT)
            }));

            // Insert Reversed Details
            for (const detail of reversedDetails) {
                await tx.insert(transactionDetails).values(detail);
            }

            // 4. Update Stock (Only if original was posted)
            if (original.status === "posted" || original.status === "paid") {
                await updateStockForTransaction(
                    reversal.id,
                    "purchase_return",
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
                        description: `Void Purchase Return #${original.invoice}`,
                        status: "posted",
                    })
                    .returning();

                // Get original mappings to reverse them
                const mappings = await tx
                    .select()
                    .from(accountMappings)
                    .where(eq(accountMappings.type, "purchase_return"));

                for (const map of mappings) {
                    await tx.insert(journalEntries).values({
                        journalId: journal.id,
                        glAccountId: await findGlAccountByCode(
                            map.glAccountCode
                        ),
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
                    type: "payable",
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
                msg: `voided purchase return #${original.invoice}`,
            });

            return res.status(200).json({
                message: "Purchase return voided successfully",
                reversal: reversal,
            });
        });
    } catch (error: any) {
        console.error("Void purchase return error:", error);
        return res.status(500).json({
            message: error.message || "Failed to void purchase return",
            error,
        });
    }
};
