import { db } from "@/db";
import {
    glAccounts,
    openInvoices,
    paymentAccounts,
    paymentLines,
    payments,
    transactions,
} from "@/db/schemas";
import { PaymentWithLinesInsert } from "@/validators/payment.validator";
import { eq, sql } from "drizzle-orm";

export async function findReceivableById(id: string) {
    const [payment] = await db
        .select()
        .from(payments)
        .where(eq(payments.id, id));

    if (!payment) return null;

    const lines = await db
        .select({
            id: paymentLines.id,
            openInvoiceId: paymentLines.openInvoiceId,
            amount: paymentLines.amount,
            openItem: {
                id: openInvoices.id,
                type: openInvoices.type,
                dueDate: openInvoices.dueDate,
                amount: openInvoices.amount,
                paidAmount: openInvoices.paidAmount,
                status: openInvoices.status,
            },
        })
        .from(paymentLines)
        .leftJoin(openInvoices, eq(paymentLines.openInvoiceId, openInvoices.id))
        .innerJoin(
            transactions,
            eq(openInvoices.transactionId, transactions.id),
        )
        .orderBy(transactions.invoice)
        .where(eq(paymentLines.paymentId, id));

    const accounts = await db
        .select({
            id: paymentAccounts.id,
            glAccountId: paymentAccounts.glAccountId,
            amount: paymentAccounts.amount,
            glAccount: {
                id: glAccounts.id,
                name: glAccounts.name,
                code: glAccounts.code,
            },
        })
        .from(paymentAccounts)
        .leftJoin(glAccounts, eq(paymentAccounts.glAccountId, glAccounts.id))
        .where(eq(paymentAccounts.paymentId, id));

    return {
        ...payment,
        lines,
        accounts,
    };
}

export async function createReceivable(
    data: PaymentWithLinesInsert,
    user: Express.User,
) {
    return await db.transaction(async (tx) => {
        const [payment] = await tx
            .insert(payments)
            .values({
                contactId: data.contactId,
                date: data.date,
                totalAmount: data.totalAmount,
                type: data.type,
                status: data.status || "draft",
            })
            .returning();

        for (const line of data.lines) {
            await tx.insert(paymentLines).values({
                paymentId: payment.id,
                openInvoiceId: line.openInvoiceId,
                amount: line.amount,
            });
        }

        for (const acc of data.accounts) {
            await tx.insert(paymentAccounts).values({
                paymentId: payment.id,
                glAccountId: acc.glAccountId,
                amount: acc.amount,
            });
        }

        return payment;
    });
}

export async function updateReceivable(
    id: string,
    data: PaymentWithLinesInsert,
) {
    return await db.transaction(async (tx) => {
        await tx
            .update(payments)
            .set({
                contactId: data.contactId,
                date: data.date,
                totalAmount: data.totalAmount,
                type: data.type,
                status: data.status || "draft",
            })
            .where(eq(payments.id, id));

        await tx.delete(paymentLines).where(eq(paymentLines.paymentId, id));
        await tx
            .delete(paymentAccounts)
            .where(eq(paymentAccounts.paymentId, id));

        for (const line of data.lines) {
            await tx.insert(paymentLines).values({
                paymentId: id,
                openInvoiceId: line.openInvoiceId,
                amount: line.amount,
            });
        }

        for (const acc of data.accounts) {
            await tx.insert(paymentAccounts).values({
                paymentId: id,
                glAccountId: acc.glAccountId,
                amount: acc.amount,
            });
        }

        return { id };
    });
}
