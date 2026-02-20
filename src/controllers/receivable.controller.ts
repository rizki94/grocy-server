import {
    createReceivable,
    findReceivableById,
    updateReceivable,
} from "@/repositories/receivable.repository";
import { postPayment, voidPayment } from "@/repositories/payment.repository";
import { Request, Response } from "express";
import { logAction } from "@/utils/log-helper";
import { db } from "@/db";
import {
    contacts,
    openInvoices,
    paymentLines,
    payments,
    transactions,
} from "@/db/schemas";
import {
    and,
    asc,
    desc,
    eq,
    like,
    or,
    sql,
    ne,
    notInArray,
    exists,
} from "drizzle-orm";
import { PgColumn } from "drizzle-orm/pg-core";
import {
    OpenInvoicesInsert,
    paymentWithLinesInsertSchema,
    paymentWithLinesUpdateSchema,
} from "@/validators/payment.validator";

export async function getReceivableById(req: Request, res: Response) {
    const { id } = req.params;
    try {
        const payment = await findReceivableById(id);
        if (!payment)
            return res.status(404).json({ message: "Receivable not found" });
        res.status(200).json(payment);
    } catch {
        res.status(500).json({ message: "Failed to fetch receivable" });
    }
}

export const getPaginatedReceivables = async (req: Request, res: Response) => {
    try {
        const query = req.query;

        const pageIndex = parseInt(query.pageIndex as string) || 0;
        const pageSize = parseInt(query.pageSize as string) || 5;
        const offset = pageIndex * pageSize;

        const search = (query.search as string) ?? "";
        const scopeData = and(eq(payments.type, "receivable"));
        const searchCondition = search
            ? or(
                like(
                    sql`LOWER(${contacts.name})`,
                    `%${search.toLowerCase()}%`,
                ),
                exists(
                    db
                        .select()
                        .from(paymentLines)
                        .innerJoin(
                            openInvoices,
                            eq(openInvoices.id, paymentLines.openInvoiceId),
                        )
                        .innerJoin(
                            transactions,
                            eq(transactions.id, openInvoices.transactionId),
                        )
                        .where(
                            and(
                                eq(paymentLines.paymentId, payments.id),
                                like(
                                    sql`LOWER(${transactions.invoice})`,
                                    `%${search.toLowerCase()}%`,
                                ),
                            ),
                        ),
                ),
            )
            : undefined;

        const filterCondition = query.select
            ? eq(payments.status, sql`${query.select}`)
            : undefined;

        const sortColumns: Record<string, PgColumn> = {
            customer: contacts.name,
        };

        const sortKey = (query.sort as string) ?? "date";
        const order = (query.order as string) === "desc" ? "desc" : "asc";

        const sortColumn = sortColumns[sortKey] ?? payments.date;

        const [receivableList, totalCount] = await Promise.all([
            db
                .select({
                    id: payments.id,
                    date: payments.date,
                    customer: contacts.name,
                    totalAmount: payments.totalAmount,
                    status: payments.status,
                    invoices: sql<string>`STRING_AGG(${transactions.invoice}, ', ')`,
                })
                .from(payments)
                .innerJoin(contacts, eq(contacts.id, payments.contactId))
                .leftJoin(paymentLines, eq(paymentLines.paymentId, payments.id))
                .leftJoin(
                    openInvoices,
                    eq(openInvoices.id, paymentLines.openInvoiceId),
                )
                .leftJoin(
                    transactions,
                    eq(transactions.id, openInvoices.transactionId),
                )
                .where(and(scopeData, searchCondition, filterCondition))
                .groupBy(payments.id, contacts.name)
                .orderBy(order === "desc" ? desc(sortColumn) : asc(sortColumn))
                .limit(pageSize)
                .offset(offset),
            db
                .select({ count: sql<number>`count(DISTINCT ${payments.id})` })
                .from(payments)
                .innerJoin(contacts, eq(contacts.id, payments.contactId))
                .where(and(scopeData, searchCondition, filterCondition)),
        ]);

        res.json({
            rows: receivableList,
            pageCount: Math.ceil(Number(totalCount[0]?.count || 0) / pageSize),
            rowCount: Number(totalCount[0]?.count || 0),
            pageIndex,
            pageSize,
            sort: sortKey,
            order,
        });
    } catch (error) {
        console.error("Error fetching receivables:", error);
        res.status(500).json({ message: "Failed to fetch receivables" });
    }
};

export const getOpenReceivableInvoices = async (
    req: Request,
    res: Response,
) => {
    const { contactId } = req.params;
    const { paymentId } = req.query;

    try {
        // Find invoices already used in other DRAFT payments
        const draftPaymentLines = await db
            .select({ openInvoiceId: paymentLines.openInvoiceId })
            .from(paymentLines)
            .innerJoin(payments, eq(paymentLines.paymentId, payments.id))
            .where(
                and(
                    eq(payments.status, "draft"),
                    eq(payments.contactId, contactId),
                    paymentId
                        ? ne(payments.id, paymentId as string)
                        : undefined,
                ),
            );

        const excludedInvoiceIds = draftPaymentLines.map(
            (l) => l.openInvoiceId,
        );

        const unpaidInvoices = await db
            .select({
                id: openInvoices.id,
                invoice: transactions.invoice,
                dueDate: openInvoices.dueDate,
                amount: openInvoices.amount,
                paidAmount: openInvoices.paidAmount,
                status: openInvoices.status,
            })
            .from(openInvoices)
            .innerJoin(
                transactions,
                eq(openInvoices.transactionId, transactions.id),
            )
            .where(
                and(
                    eq(openInvoices.type, "receivable"),
                    eq(openInvoices.contactId, contactId),
                    ne(openInvoices.status, "paid"),
                    excludedInvoiceIds.length > 0
                        ? notInArray(openInvoices.id, excludedInvoiceIds)
                        : undefined,
                ),
            );

        let paymentLinesData: OpenInvoicesInsert[] = [];

        if (paymentId) {
            const lines = await db
                .select({
                    id: openInvoices.id,
                    invoice: transactions.invoice,
                    dueDate: openInvoices.dueDate,
                    amount: openInvoices.amount,
                    paidAmount: openInvoices.paidAmount,
                    status: openInvoices.status,
                })
                .from(paymentLines)
                .innerJoin(
                    openInvoices,
                    eq(paymentLines.openInvoiceId, openInvoices.id),
                )
                .innerJoin(
                    transactions,
                    eq(openInvoices.transactionId, transactions.id),
                )
                .where(eq(paymentLines.paymentId, paymentId as string));

            paymentLinesData = lines;
        }

        const allMap = new Map<string, OpenInvoicesInsert>();
        [...unpaidInvoices, ...paymentLinesData].forEach((inv) => {
            allMap.set(inv.id, inv);
        });

        const allInvoices = Array.from(allMap.values()).sort((a, b) =>
            a.invoice.localeCompare(b.invoice),
        );

        return res.json(allInvoices);
    } catch (err) {
        console.error(err);
        return res
            .status(500)
            .json({ message: "Failed to fetch open receivable" });
    }
};

export const createReceivableController = async (
    req: Request,
    res: Response,
) => {
    const parsed = paymentWithLinesInsertSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }
    const payment = parsed.data;

    try {
        const createdPayment = await createReceivable(payment, req.user!);

        logAction(req, {
            action: "insert",
            table: "payments",
            data: createdPayment,
            userId: req.user!.id,
            msg: `created receivable #${createdPayment.id}`,
        });

        return res.status(201).json(createdPayment);
    } catch (error) {
        console.error("Error creating receivable:", error);
        return res.status(500).json({ message: "Failed to create receivable" });
    }
};

export const updateReceivableController = async (
    req: Request,
    res: Response,
) => {
    const parsed = paymentWithLinesUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }
    const payment = parsed.data;

    try {
        const updatedPayment = await updateReceivable(payment.id, payment);

        logAction(req, {
            action: "update",
            table: "payments",
            data: updatedPayment,
            userId: req.user!.id,
            msg: `updated receivable #${payment.id}`,
        });

        res.json({
            message: "Receivable updated successfully",
            updatedPayment,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to update receivable" });
    }
};
export const postReceivableController = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const result = await postPayment(id);

        logAction(req, {
            action: "update",
            table: "payments",
            data: { id, status: "posted" },
            userId: req.user!.id,
            msg: `posted receivable #${id}`,
        });

        res.json({ message: "Receivable posted successfully", ...result });
    } catch (err: any) {
        console.error(err);
        res.status(400).json({
            message: err.message || "Failed to post receivable",
        });
    }
};

export const voidReceivableController = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const result = await voidPayment(id);

        logAction(req, {
            action: "update",
            table: "payments",
            data: { id, status: "voided" },
            userId: req.user!.id,
            msg: `voided receivable #${id}`,
        });

        res.json({ message: "Receivable voided successfully", ...result });
    } catch (err: any) {
        console.error("Void receivable error:", err);
        res.status(400).json({
            message: err.message || "Failed to void receivable",
        });
    }
};
