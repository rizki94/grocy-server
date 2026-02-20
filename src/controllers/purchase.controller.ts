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
import { TransactionType } from "@/constants/transaction.constant";
import { parseTableQuery } from "@/services/table-query";

export async function getAllPurchases(req: Request, res: Response) {
    try {
        const data = await CacheService.getOrSet(
            "purchases:all",
            60,
            async () => {
                return db
                    .select()
                    .from(transactions)
                    .where(eq(transactions.type, "purchase"))
                    .orderBy(transactions.invoice);
            },
        );
        res.status(200).json(data);
    } catch (error) {
        console.error("Error fetching purchases:", error);
        res.status(500).json({ message: "Failed to fetch purchases" });
    }
}

export const getPurchaseById = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        const rows = await purchaseById(id);

        if (rows.length === 0) {
            return res
                .status(404)
                .json({ error: "Purchase transaction not found" });
        }

        const { transaction } = rows[0];
        const details = rows.filter((r) => r.detail).map((r) => r.detail!);

        res.status(200).json({ ...transaction, details });
    } catch (error) {
        console.error("Error fetching purchase transaction:", error);
        res.status(500).json({
            message: "Failed to fetch purchase transaction",
        });
    }
};

export const createPurchase = async (req: Request, res: Response) => {
    const parsed = transactionWithDetailInsertSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    const purchase = parsed.data;
    const invoice = await generateInvoice("purchase");

    try {
        const [createdPurchase] = await db
            .insert(transactions)
            .values({
                ...purchase,
                invoice,
                type: "purchase",
                status: "order",
                userId: req.user!.id,
            })
            .returning();

        for (const detail of purchase.details) {
            await db
                .insert(transactionDetails)
                .values({
                    transactionId: createdPurchase.id,
                    ...detail,
                    movementType: 1,
                })
                .returning();
        }

        logAction(req, {
            action: "update",
            table: "transactions",
            data: {
                transaction: createdPurchase,
                details: purchase.details,
            },
            userId: req.user!.id,
            msg: `created purchase #${createdPurchase.id}`,
        });

        const rows = await purchaseById(createdPurchase.id);
        const { transaction } = rows[0];
        const details = rows.filter((r) => r.detail).map((r) => r.detail!);

        return res.status(201).json({
            message: "Purchase created successfully",
            purchase: { ...transaction, details },
        });
    } catch (error) {
        console.error("Create purchase error:", error);
        return res
            .status(500)
            .json({ message: "Failed to create purchase", error });
    }
};

export const updatePurchase = async (req: Request, res: Response) => {
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

        if (oldPurchase.status === "posted" || oldPurchase.status === "paid") {
            return res.status(400).json({
                message: "Cannot edit a posted or paid purchase transaction",
            });
        }

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
                        movementType: 1,
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

export const postPurchase = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        let postedPurchase: any;

        await db.transaction(async (tx) => {
            // Guard: check current status first
            const [existing] = await tx
                .select()
                .from(transactions)
                .where(eq(transactions.id, id));

            if (!existing) throw new Error("Purchase not found");
            if (existing.status !== "draft" && existing.status !== "order") {
                throw new Error(
                    `Purchase is already ${existing.status} and cannot be posted again`,
                );
            }

            // Guard: check no journal already exists for this transaction
            const [existingJournal] = await tx
                .select()
                .from(journals)
                .where(eq(journals.transactionId, id));

            if (existingJournal) {
                throw new Error(
                    "A journal has already been posted for this purchase transaction",
                );
            }

            const [purchase] = await tx
                .update(transactions)
                .set({ status: "posted" })
                .where(eq(transactions.id, id))
                .returning();

            if (!purchase) throw new Error("Purchase not found");

            const details = await tx
                .select()
                .from(transactionDetails)
                .where(eq(transactionDetails.transactionId, id));

            if (!details.length) {
                throw new Error("Purchase has no details");
            }

            await updateStockForTransaction(id, "purchase", details);

            const mappings = await tx
                .select()
                .from(accountMappings)
                .where(eq(accountMappings.type, "purchase"));

            const [journal] = await tx
                .insert(journals)
                .values({
                    transactionId: purchase.id,
                    date: purchase.date,
                    description: `Posting pembelian #${purchase.invoice}`,
                    status: "posted",
                })
                .returning();

            for (const map of mappings) {
                await tx.insert(journalEntries).values({
                    journalId: journal.id,
                    glAccountId: await findGlAccountByCode(map.glAccountCode),
                    debit:
                        map.side === "debit" ? Number(purchase.totalAmount) : 0,
                    credit:
                        map.side === "credit"
                            ? Number(purchase.totalAmount)
                            : 0,
                    note: map.note,
                });
            }

            await tx.insert(openInvoices).values({
                transactionId: purchase.id,
                contactId: purchase.contactId,
                type: "payable",
                dueDate: addDays(purchase.date, purchase.termOfPayment),
                amount: Number(purchase.totalAmount),
                paidAmount: 0,
                status: "open",
            });

            postedPurchase = purchase;

            logAction(req, {
                action: "update",
                table: "transactions",
                data: purchase,
                userId: req.user!.id,
                msg: `posted purchase #${purchase.id}`,
            });
        });

        // Response is sent AFTER transaction commits to avoid race condition
        return res.status(200).json({
            message: "Purchase posted successfully",
            purchase: postedPurchase,
        });
    } catch (error: any) {
        console.error("Post purchase error:", error);
        return res.status(error instanceof Error ? 400 : 500).json({
            message: error.message || "Failed to post purchase",
            error,
        });
    }
};

export const getPaginatedPurchases = async (req: Request, res: Response) => {
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
                })
                .from(transactions)
                .innerJoin(contacts, eq(contacts.id, transactions.contactId))
                .where(
                    and(
                        eq(transactions.type, "purchase"),
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
                        eq(transactions.type, "purchase"),
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

export const getLastPurchasePrice = async (req: Request, res: Response) => {
    const { contactId, productId, productDetailId } = req.query;

    if (!contactId || !productId || !productDetailId) {
        return res.status(400).json({ message: "Missing required parameters" });
    }

    try {
        const lastPrice = await db
            .select({ price: transactionDetails.price })
            .from(transactionDetails)
            .innerJoin(
                transactions,
                eq(transactions.id, transactionDetails.transactionId),
            )
            .where(
                and(
                    eq(transactions.contactId, contactId as string),
                    eq(transactions.type, "purchase"),
                    eq(transactionDetails.productId, productId as string),
                    eq(
                        transactionDetails.productDetailId,
                        productDetailId as string,
                    ),
                ),
            )
            .orderBy(desc(transactions.date), desc(transactions.createdAt))
            .limit(1)
            .then((rows) => rows[0]?.price);

        return res.status(200).json({ price: lastPrice || 0 });
    } catch (error) {
        console.error("Error fetching last purchase price:", error);
        return res.status(500).json({ message: "Failed to fetch last price" });
    }
};
export const getPostedPurchasesByContact = async (
    req: Request,
    res: Response,
) => {
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
                    eq(transactions.type, "purchase"),
                    or(
                        eq(transactions.status, "posted"),
                        eq(transactions.status, "paid"),
                    ),
                ),
            )
            .orderBy(desc(transactions.date));
        res.status(200).json(data);
    } catch (error) {
        console.error("Error fetching posted purchases:", error);
        res.status(500).json({ message: "Failed to fetch posted purchases" });
    }
};

export const cancelPurchase = async (req: Request, res: Response) => {
    const { id } = req.params;
    console.log(`[cancelPurchase] Starting for ID: ${id}`);
    try {
        await db.transaction(async (tx) => {
            // 1. Get Original Transaction
            const [original] = await tx
                .select()
                .from(transactions)
                .where(eq(transactions.id, id));

            if (!original) throw new Error("Purchase not found");
            if (original.status !== "posted") {
                throw new Error("Only posted purchases can be voided");
            }

            // 2. Check for Payments
            const [invoice] = await tx
                .select()
                .from(openInvoices)
                .where(eq(openInvoices.transactionId, id));

            if (invoice && Number(invoice.paidAmount) > 0) {
                throw new Error(
                    "Cannot void purchase with existing payments. Void payments first.",
                );
            }

            // 3. Fetch Original Details
            const originalDetails = await tx
                .select()
                .from(transactionDetails)
                .where(eq(transactionDetails.transactionId, id));

            // 4. Create Reversal Transaction
            const reversalInvoice = await generateInvoice("purchase");
            const [reversal] = await tx
                .insert(transactions)
                .values({
                    userId: req.user!.id,
                    type: "purchase", // Keep type purchase, but movements will be OUT
                    invoice: reversalInvoice,
                    reference: `Void of ${original.invoice}`,
                    contactId: original.contactId,
                    termOfPayment: original.termOfPayment,
                    date: new Date().toISOString(),
                    status: "posted",
                    updatedAt: new Date(),
                    totalAmount: original.totalAmount, // Negative? No, keep absolute, journal handles direction
                })
                .returning();

            // 5. Create Reversed Details (Invert Movement Type)
            // Purchase was 1 (IN). Reversal is -1 (OUT).
            const reversedDetails = originalDetails.map((detail) => ({
                ...detail,
                transactionId: reversal.id,
                movementType: -1,
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
                    unitCost: detail.unitCost,
                    totalCost: detail.totalCost,
                    movementType: detail.movementType,
                });
            }

            // 6. Update Stock (Process logic for Reversal - OUT)
            await updateStockForTransaction(
                reversal.id,
                "purchase",
                reversedDetails as any, // Cast because 'purchase' usually expects IN, but we force OUT movements
                tx,
            );

            // 7. Create Reversal Journal
            const [journal] = await tx
                .insert(journals)
                .values({
                    transactionId: reversal.id,
                    date: reversal.date,
                    description: `Void Purchase #${original.invoice}`,
                    status: "posted",
                })
                .returning();

            // Use same accounts but swap Debit/Credit
            const mappings = await tx
                .select()
                .from(accountMappings)
                .where(eq(accountMappings.type, "purchase"));

            const total = Number(original.totalAmount); // Assuming simple total

            for (const map of mappings) {
                // Swap logic: Debit becomes Credit, Credit becomes Debit
                await tx.insert(journalEntries).values({
                    journalId: journal.id,
                    glAccountId: await findGlAccountByCode(map.glAccountCode),
                    debit: map.side === "credit" ? total : 0, // Swapped
                    credit: map.side === "debit" ? total : 0, // Swapped
                    note: `Void ${map.note}`,
                });
            }

            // 8. Delete Original Payable (Open Invoice)
            // This "Unposts" the AP impact.
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

            console.log(`[cancelPurchase] Void complete.`);

            logAction(req, {
                action: "update",
                table: "transactions",
                data: original,
                userId: req.user!.id,
                msg: `voided purchase #${original.id}`,
            });
        });

        res.status(200).json({ message: "Purchase voided successfully" });
    } catch (error: any) {
        console.error("Void purchase error:", error);
        res.status(500).json({
            message: error.message || "Failed to void purchase",
        });
    }
};
