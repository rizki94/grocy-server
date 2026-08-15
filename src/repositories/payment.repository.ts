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
                reference: data.reference,
                note: data.note,
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
                reference: data.reference,
                note: data.note,
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

            const currentPaid = Number(openItem.paidAmount || 0);
            const paying = Number(line.amount);
            const total = Number(openItem.amount);

            const newPaidAmount = currentPaid + paying;

            // Determine new status:
            //   overpaid  → paid more than the invoice (negative balance owed back to customer)
            //   paid      → exactly or fully covered (within floating-point tolerance)
            //   partial   → still some remaining
            let newStatus: "open" | "partial" | "paid" | "overpaid";
            const paidCents = Math.round(newPaidAmount * 100);
            const totalCents = Math.round(total * 100);

            if (paidCents > totalCents) {
                newStatus = "overpaid";
            } else if (paidCents >= totalCents) {
                newStatus = "paid";
            } else {
                newStatus = "partial";
            }

            await tx
                .update(openInvoices)
                .set({
                    paidAmount: newPaidAmount,
                    status: newStatus,
                    updatedAt: new Date(),
                })
                .where(eq(openInvoices.id, line.openInvoiceId));

            if (openItem.transactionId) {
                // Map overpaid → paid on the transaction level (the invoice itself is settled)
                const txStatus = newStatus === "overpaid" ? "paid" : newStatus;
                await tx
                    .update(transactions)
                    .set({
                        status: txStatus,
                        updatedAt: new Date(),
                    })
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

        const invoiceList = await tx
            .select({ invoice: transactions.invoice })
            .from(paymentLines)
            .innerJoin(openInvoices, eq(paymentLines.openInvoiceId, openInvoices.id))
            .innerJoin(transactions, eq(openInvoices.transactionId, transactions.id))
            .where(eq(paymentLines.paymentId, id));

        const concatenatedInvoices = invoiceList.map((i) => i.invoice).join(", ");
        const paymentTypeName = payment.type === "payable" ? "Keluar" : "Masuk";

        const [journal] = await tx
            .insert(journals)
            .values({
                date: payment.date,
                description: payment.note || `Pembayaran ${paymentTypeName} ${concatenatedInvoices}${payment.reference ? ` (${payment.reference})` : ""}`,
                status: "posted",
                transactionId: null,
            })
            .returning();

        // 1. Bank/Cash Side (from paymentAccounts)
        const paymentAccs = await tx
            .select()
            .from(paymentAccounts)
            .where(eq(paymentAccounts.paymentId, id));

        for (const acc of paymentAccs) {
            const amt = Number(acc.amount);
            let debit = 0;
            let credit = 0;
            if (payment.type === "receivable") {
                if (amt >= 0) debit = amt;
                else credit = Math.abs(amt);
            } else {
                if (amt >= 0) credit = amt;
                else debit = Math.abs(amt);
            }

            await tx.insert(journalEntries).values({
                journalId: journal.id,
                glAccountId: acc.glAccountId!,
                debit,
                credit,
                note: `Penerimaan/Pengeluaran Kas/Bank ${concatenatedInvoices}`,
            });
        }

        // 2. AP/AR Side (Balancing)
        const totalAmt = Number(payment.totalAmount);
        let arApDebit = 0;
        let arApCredit = 0;
        if (payment.type === "receivable") {
            if (totalAmt >= 0) arApCredit = totalAmt;
            else arApDebit = Math.abs(totalAmt);
        } else {
            if (totalAmt >= 0) arApDebit = totalAmt;
            else arApCredit = Math.abs(totalAmt);
        }

        await tx.insert(journalEntries).values({
            journalId: journal.id,
            glAccountId: apArMapping.glAccountId,
            debit: arApDebit,
            credit: arApCredit,
            note: `Pelunasan ${payment.type === "payable" ? "Hutang" : "Piutang"} ${concatenatedInvoices}`,
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

            if (!openItem) continue;

            const newPaidAmount =
                Number(openItem.paidAmount || 0) - Number(line.amount);

            const safePaidAmount = newPaidAmount < 0 ? 0 : newPaidAmount;
            const totalAmount = Number(openItem.amount);
            const paidCents = Math.round(safePaidAmount * 100);
            const totalCents = Math.round(totalAmount * 100);

            let newStatus: "open" | "partial" | "paid" | "overpaid" = "open";
            if (paidCents > totalCents) {
                newStatus = "overpaid"; // still overpaid after reversal (edge case)
            } else if (paidCents >= totalCents) {
                newStatus = "paid";
            } else if (paidCents > 0) {
                newStatus = "partial";
            }

            await tx
                .update(openInvoices)
                .set({
                    paidAmount: safePaidAmount,
                    status: newStatus,
                })
                .where(eq(openInvoices.id, line.openInvoiceId));

            if (openItem.transactionId) {
                let transStatus: any = "posted";
                if (newStatus === "paid" || newStatus === "overpaid") transStatus = "paid";
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
            const amt = Number(acc.amount);
            let debit = 0;
            let credit = 0;
            if (payment.type === "receivable") {
                if (amt >= 0) credit = amt;
                else debit = Math.abs(amt);
            } else {
                if (amt >= 0) debit = amt;
                else credit = Math.abs(amt);
            }

            await tx.insert(journalEntries).values({
                journalId: journal.id,
                glAccountId: acc.glAccountId!,
                debit,
                credit,
                note: `Void Payment fund`,
            });
        }

        // AP/AR Side (Restore Debt)
        const totalAmt = Number(payment.totalAmount);
        let arApDebit = 0;
        let arApCredit = 0;
        if (payment.type === "receivable") {
            if (totalAmt >= 0) arApDebit = totalAmt;
            else arApCredit = Math.abs(totalAmt);
        } else {
            if (totalAmt >= 0) arApCredit = totalAmt;
            else arApDebit = Math.abs(totalAmt);
        }

        await tx.insert(journalEntries).values({
            journalId: journal.id,
            glAccountId: apArMapping.glAccountId,
            debit: arApDebit,
            credit: arApCredit,
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

export async function findPaymentsByTransactionId(transactionId: string) {
    return await db
        .select({
            id: payments.id,
            date: payments.date,
            totalAmount: payments.totalAmount,
            status: payments.status,
            reference: payments.reference,
            note: payments.note,
            amountPaid: paymentLines.amount,
        })
        .from(paymentLines)
        .innerJoin(payments, eq(paymentLines.paymentId, payments.id))
        .innerJoin(openInvoices, eq(paymentLines.openInvoiceId, openInvoices.id))
        .where(eq(openInvoices.transactionId, transactionId));
}
