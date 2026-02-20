import { db } from "@/db";
import {
    glAccounts,
    openInvoices,
    paymentAccounts,
    paymentLines,
    payments,
    transactions,
    journals,
    journalEntries,
    accountMappings,
} from "@/db/schemas";
import { PaymentWithLinesInsert } from "@/validators/payment.validator";
import { eq, sql, and } from "drizzle-orm";

export async function findPaymentById(id: string) {
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
            invoice: transactions.invoice,
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
        .leftJoin(transactions, eq(openInvoices.transactionId, transactions.id))
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

export async function createPayment(
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

export async function updatePayment(id: string, data: PaymentWithLinesInsert) {
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

export async function postPayment(id: string) {
    return await db.transaction(async (tx) => {
        const [payment] = await tx
            .select()
            .from(payments)
            .where(eq(payments.id, id));

        if (!payment) throw new Error("Payment not found");
        if (payment.status !== "draft") {
            throw new Error(
                `Payment is already ${payment.status} and cannot be posted again`,
            );
        }

        const lines = await tx
            .select()
            .from(paymentLines)
            .where(eq(paymentLines.paymentId, id));

        for (const line of lines) {
            const [openItem] = await tx
                .select()
                .from(openInvoices)
                .where(eq(openInvoices.id, line.openInvoiceId));

            if (!openItem) throw new Error("Open item not found");

            const newPaidAmount =
                (openItem.paidAmount || 0) + Number(line.amount);
            const isFullyPaid = newPaidAmount >= Number(openItem.amount);

            await tx
                .update(openInvoices)
                .set({
                    paidAmount: newPaidAmount,
                    status: isFullyPaid ? "paid" : "partial",
                })
                .where(eq(openInvoices.id, line.openInvoiceId));

            if (openItem.transactionId) {
                await tx
                    .update(transactions)
                    .set({ status: isFullyPaid ? "paid" : "partial" })
                    .where(eq(transactions.id, openItem.transactionId));
            }
        }

        // GL Entries Logic
        const mappingType = payment.type === "payable" ? "purchase" : "sales";
        const mappingSide = payment.type === "payable" ? "credit" : "debit";

        const [apArMapping] = await tx
            .select({
                glAccountId: glAccounts.id,
            })
            .from(accountMappings)
            .innerJoin(
                glAccounts,
                eq(accountMappings.glAccountCode, glAccounts.code),
            )
            .where(
                and(
                    eq(accountMappings.type, mappingType),
                    eq(accountMappings.side, mappingSide),
                ),
            );

        if (!apArMapping) {
            throw new Error(
                `GL Account mapping for ${mappingType} ${mappingSide} not found`,
            );
        }

        const [journal] = await tx
            .insert(journals)
            .values({
                date: payment.date,
                description: `Payment ${payment.type === "payable" ? "Out" : "In"} #${id}`,
                status: "posted",
                transactionId: null, // Payment doesn't link to transaction directly in journlas usually, or we can leave null
            })
            .returning();

        // 1. Bank/Cash Side (from paymentAccounts)
        const paymentAccs = await tx
            .select()
            .from(paymentAccounts)
            .where(eq(paymentAccounts.paymentId, id));

        for (const acc of paymentAccs) {
            await tx.insert(journalEntries).values({
                journalId: journal.id,
                glAccountId: acc.glAccountId!,
                debit: payment.type === "receivable" ? Number(acc.amount) : 0,
                credit: payment.type === "payable" ? Number(acc.amount) : 0,
                note: `Payment fund`,
            });
        }

        // 2. AP/AR Side (Balancing)
        await tx.insert(journalEntries).values({
            journalId: journal.id,
            glAccountId: apArMapping.glAccountId,
            debit: payment.type === "payable" ? Number(payment.totalAmount) : 0,
            credit:
                payment.type === "receivable" ? Number(payment.totalAmount) : 0,
            note: `Payment clearing ${payment.type}`,
        });

        await tx
            .update(payments)
            .set({ status: "posted" })
            .where(eq(payments.id, id));

        return { id, status: "posted" };
    });
}

export async function voidPayment(id: string) {
    return await db.transaction(async (tx) => {
        // 1. Get Payment
        const [payment] = await tx
            .select()
            .from(payments)
            .where(eq(payments.id, id));

        if (!payment) throw new Error("Payment not found");
        if (payment.status !== "posted") {
            throw new Error("Only posted payments can be voided");
        }

        // 2. Reverse Payment Lines (Update Open Invoices)
        const lines = await tx
            .select()
            .from(paymentLines)
            .where(eq(paymentLines.paymentId, id));

        for (const line of lines) {
            const [openItem] = await tx
                .select()
                .from(openInvoices)
                .where(eq(openInvoices.id, line.openInvoiceId));

            if (!openItem) continue; // Should not happen, but safe check

            const newPaidAmount =
                Number(openItem.paidAmount || 0) - Number(line.amount);

            // Validate non-negative
            const safePaidAmount = newPaidAmount < 0 ? 0 : newPaidAmount;
            const totalAmount = Number(openItem.amount);

            let newStatus: "open" | "partial" | "paid" = "open";
            if (safePaidAmount >= totalAmount) {
                newStatus = "paid";
            } else if (safePaidAmount > 0) {
                newStatus = "partial";
            }

            await tx
                .update(openInvoices)
                .set({
                    paidAmount: safePaidAmount,
                    status: newStatus,
                })
                .where(eq(openInvoices.id, line.openInvoiceId));

            // 3. Update Transaction Status
            if (openItem.transactionId) {
                let transStatus: any = "posted";
                if (newStatus === "paid") transStatus = "paid";
                else if (newStatus === "partial") transStatus = "partial";

                await tx
                    .update(transactions)
                    .set({ status: transStatus })
                    .where(eq(transactions.id, openItem.transactionId));
            }
        }

        // 4. Create Reversal Journal
        const mappingType = payment.type === "payable" ? "purchase" : "sales"; // Same as Post
        // Post logic used logic: AP (Liability) Credit Side.
        const mappingSide = payment.type === "payable" ? "credit" : "debit";

        const [apArMapping] = await tx
            .select({
                glAccountId: glAccounts.id,
            })
            .from(accountMappings)
            .innerJoin(
                glAccounts,
                eq(accountMappings.glAccountCode, glAccounts.code),
            )
            .where(
                and(
                    eq(accountMappings.type, mappingType),
                    eq(accountMappings.side, mappingSide),
                ),
            );

        if (!apArMapping) {
            throw new Error(
                `GL Account mapping for ${mappingType} ${mappingSide} not found`,
            );
        }

        const [journal] = await tx
            .insert(journals)
            .values({
                date: payment.date,
                description: `Void Payment ${payment.type === "payable" ? "Out" : "In"} #${id}`,
                status: "posted",
                transactionId: null,
            })
            .returning();

        // 5. Reverse GL Entries

        // Bank/Cash Side (Restore Cash)
        // Original Post: Credit Cash (Payable).
        // Void: Debit Cash (Payable).
        const paymentAccs = await tx
            .select()
            .from(paymentAccounts)
            .where(eq(paymentAccounts.paymentId, id));

        for (const acc of paymentAccs) {
            await tx.insert(journalEntries).values({
                journalId: journal.id,
                glAccountId: acc.glAccountId!,
                debit: payment.type === "payable" ? Number(acc.amount) : 0,
                credit: payment.type === "receivable" ? Number(acc.amount) : 0,
                note: `Void Payment fund`,
            });
        }

        // AP/AR Side (Restore Debt)
        // Original Post: Debit AP (Payable).
        // Void: Credit AP (Payable).
        await tx.insert(journalEntries).values({
            journalId: journal.id,
            glAccountId: apArMapping.glAccountId,
            debit:
                payment.type === "receivable" ? Number(payment.totalAmount) : 0,
            credit:
                payment.type === "payable" ? Number(payment.totalAmount) : 0,
            note: `Void Payment clearing ${payment.type}`,
        });

        // 6. Update Payment Status
        await tx
            .update(payments)
            .set({ status: "cancelled" as any })
            .where(eq(payments.id, id));

        return { id, status: "cancelled" };
    });
}
