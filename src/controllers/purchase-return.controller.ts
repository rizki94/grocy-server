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

    const purchase = parsed.data;
    const invoice = await generateInvoice("purchase_return");

    try {
        const [createdPurchase] = await db
            .insert(transactions)
            .values({
                ...purchase,
                invoice,
                type: "purchase_return",
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
                    movementType: -1, // OUT
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
            const [purchase] = await tx
                .update(transactions)
                .set({ status: "posted" })
                .where(eq(transactions.id, id))
                .returning();

            if (!purchase) {
                return res.status(404).json({ message: "Purchase not found" });
            }

            const details = await tx
                .select()
                .from(transactionDetails)
                .where(eq(transactionDetails.transactionId, id));

            if (!details.length) {
                return res
                    .status(400)
                    .json({ message: "Purchase has no details" });
            }

            await updateStockForTransaction(id, "purchase_return", details);

            const total = details.reduce(
                (sum, d) => sum + Number(d.qty) * Number(d.price),
                0,
            );

            const mappings = await tx
                .select()
                .from(accountMappings)
                .where(eq(accountMappings.type, "purchase_return"));

            const [journal] = await tx
                .insert(journals)
                .values({
                    transactionId: purchase.id,
                    date: purchase.date,
                    description: `Retur Pembelian #${purchase.invoice}`,
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
                type: "receivable",
                dueDate: addDays(purchase.date, purchase.termOfPayment),
                amount: Number(purchase.totalAmount),
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
                message: "Purchase posted successfully",
                purchase: purchase,
            });
        });
    } catch (error: any) {
        console.error("Post purchase error:", error);
        return res.status(error instanceof Error ? 400 : 500).json({
            message: error.message || "Failed to post purchase",
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
