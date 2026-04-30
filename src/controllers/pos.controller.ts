import { db } from "@/db";
import {
    transactionDetails,
    transactions,
    posSessions,
    openInvoices,
    payments,
    paymentLines,
    paymentAccounts,
    contacts,
    glAccounts,
    users,
    paymentMethods,
    journals,
    journalEntries,
    accountMappings,
    settings,
} from "@/db/schemas";
import { generateInvoice } from "@/helpers/generate-invoice";
import { updateStockForTransaction } from "@/repositories/stock.repository";
import { Request, Response } from "express";
import { eq, and, ilike, or } from "drizzle-orm";
import { logAction } from "@/utils/log-helper";
import { findGlAccountByCode } from "@/repositories/gl-account.repository";

export async function checkout(req: Request, res: Response) {
    const {
        details,
        subtotal,
        totalDiscount,
        totalTax,
        totalAmount,
        paymentMethod, // This might be an ID or string now
        posSessionId,
        paidAmount: providedPaidAmount,
    } = req.body;

    const paidAmount =
        providedPaidAmount !== undefined
            ? Number(providedPaidAmount)
            : totalAmount;

    try {
        // 1. Validate POS Session
        const session = await db
            .select()
            .from(posSessions)
            .where(
                and(
                    eq(posSessions.id, posSessionId),
                    eq(posSessions.status, "open"),
                ),
            )
            .limit(1)
            .then((r) => r[0]);

        if (!session) {
            return res
                .status(400)
                .json({ message: "Active POS session is required" });
        }

        // 2. Get User for specific GL Account and Warehouse
        const user = await db
            .select()
            .from(users)
            .where(eq(users.id, req.user!.id))
            .limit(1)
            .then((r) => r[0]);

        // 3. Get Default Customer (General Customer)
        const customer = await db
            .select()
            .from(contacts)
            .where(eq(contacts.name, "General Customer"))
            .limit(1)
            .then((r) => r[0]);

        const contactId = customer?.id;

        const result = await db.transaction(async (tx) => {
            const invoice = await generateInvoice("pos_sales");

            const globalSettings = await tx.select().from(settings).where(eq(settings.id, "global")).limit(1).then(r => r[0]);
            
            const originalTotalAmount = subtotal - totalDiscount + totalTax;
            let finalTotalAmount = originalTotalAmount;
            let roundingDifference = 0;

            if (globalSettings?.posRound2Digit) {
                finalTotalAmount = Math.ceil(originalTotalAmount / 100) * 100;
                roundingDifference = finalTotalAmount - originalTotalAmount;
            }

            // 4. Create Transaction
            const [transaction] = await tx
                .insert(transactions)
                .values({
                    type: "pos_sales",
                    invoice,
                    contactId,
                    date: new Date().toISOString().split("T")[0],
                    subtotal,
                    totalDiscount,
                    totalTax,
                    totalAmount: originalTotalAmount,
                    status: paidAmount >= finalTotalAmount ? "paid" : "order",
                    userId: req.user!.id,
                    posSessionId,
                    reference: paymentMethod,
                })
                .returning();

            // 5. Create Transaction Details
            const finalDetails = [];
            for (const d of details) {
                const [detail] = await tx
                    .insert(transactionDetails)
                    .values({
                        transactionId: transaction.id,
                        productId: d.productId,
                        productDetailId: d.productDetailId || d.id,
                        warehouseId:
                            d.warehouseId || user?.posWarehouseId || null,
                        qty: d.qty,
                        price: d.price,
                        discount: d.discount,
                        amount: d.amount,
                        baseRatio: d.baseRatio,
                        unitCost: d.unitCost,
                        totalCost: d.totalCost,
                        taxRate: d.taxRate,
                        movementType: -1, // OUT
                    })
                    .returning();
                finalDetails.push(detail);
            }

            // 6. Update Stock
            const transDetails = finalDetails.map((d: any) => ({
                productId: d.productId,
                warehouseId: d.warehouseId || null,
                qty: d.qty,
                baseRatio: d.baseRatio,
                movementType: -1, // OUT
                unitCost: d.unitCost,
            }));
            await updateStockForTransaction(
                transaction.id,
                "pos_sales",
                transDetails,
                tx as any,
            );

            // 7. Create Sales Journal
            const mappings = await tx
                .select()
                .from(accountMappings)
                .where(
                    or(
                        eq(accountMappings.type, "sales"),
                        eq(accountMappings.type, "sales_tax"),
                    ),
                );

            const [salesJournal] = await tx
                .insert(journals)
                .values({
                    transactionId: transaction.id,
                    date: transaction.date,
                    description: `Penjualan ${transaction.invoice}`,
                    status: "posted",
                })
                .returning();

            for (const map of mappings) {
                let amount = 0;
                if (map.type === "sales") {
                    if (map.side === "debit") {
                        amount = originalTotalAmount; // AR
                    } else {
                        amount = subtotal - totalDiscount; // Revenue
                    }
                } else if (map.type === "sales_tax") {
                    amount = totalTax; // Tax
                }

                if (amount === 0) continue;

                await tx.insert(journalEntries).values({
                    journalId: salesJournal.id,
                    glAccountId: await findGlAccountByCode(map.glAccountCode),
                    debit: map.side === "debit" ? amount : 0,
                    credit: map.side === "credit" ? amount : 0,
                    note: `${map.note} ${transaction.invoice}`,
                });
            }

            // COGS and Inventory for POS
            const totalCogs = finalDetails.reduce(
                (sum, d) => sum + Number(d.totalCost || 0),
                0,
            );

            if (totalCogs > 0) {
                await tx.insert(journalEntries).values({
                    journalId: salesJournal.id,
                    glAccountId: await findGlAccountByCode("5100"), // COGS
                    debit: totalCogs,
                    credit: 0,
                    note: `Beban Pokok Penjualan ${transaction.invoice}`,
                });
                await tx.insert(journalEntries).values({
                    journalId: salesJournal.id,
                    glAccountId: await findGlAccountByCode("1400"), // Inventory
                    debit: 0,
                    credit: totalCogs,
                    note: `Pengurangan Persediaan ${transaction.invoice}`,
                });
            }

            // 8. Handle Payment
            // Create Open Invoice
            const [openInvoice] = await tx
                .insert(openInvoices)
                .values({
                    transactionId: transaction.id,
                    contactId,
                    type: "receivable",
                    dueDate: new Date().toISOString().split("T")[0],
                    amount: originalTotalAmount,
                    paidAmount: paidAmount,
                    status:
                        paidAmount >= originalTotalAmount
                            ? "paid"
                            : paidAmount > 0
                              ? "partial"
                              : "open",
                })
                .returning();

            // Process payments (support multiple payments for split payment feature)
            const paymentItems = req.body.payments || [
                { method: paymentMethod, amount: paidAmount },
            ];

            for (const item of paymentItems) {
                let itemAmount = Number(item.amount);
                if (itemAmount <= 0) continue;

                // Cap the payment to the remaining total (including rounding)
                // This handles cases where customer pays 51000 for a 50172 bill
                const totalWithRounding = finalTotalAmount;
                if (itemAmount > totalWithRounding) {
                    itemAmount = totalWithRounding;
                }

                // Create Payment Record
                const [payment] = await tx
                    .insert(payments)
                    .values({
                        contactId,
                        date: new Date().toISOString().split("T")[0],
                        type: "receivable",
                        totalAmount: itemAmount,
                        status: "posted",
                    })
                    .returning();

                // Record Payment Account (Ledger hit)
                let glAccountId: string | null = null;
                const activeMethodName = item.method;

                const [method] = await tx
                    .select()
                    .from(paymentMethods)
                    .where(ilike(paymentMethods.name, activeMethodName))
                    .limit(1);

                // Link Payment to Invoice
                // Calculate how much of this payment goes to reducing the AR
                let arReduction = itemAmount;
                let roundAmount = 0;

                if (globalSettings?.posRound2Digit && method?.isCash) {
                    // Apply rounding logic to the AR reduction vs actual cash received
                    roundAmount = roundingDifference;
                    arReduction = itemAmount - roundingDifference;
                }

                await tx.insert(paymentLines).values({
                    paymentId: payment.id,
                    openInvoiceId: openInvoice.id,
                    amount: arReduction,
                });

                // Priority 1: If method is marked as 'isCash', try user's specific cashier account
                if (method?.isCash && user?.cashGlAccountId) {
                    glAccountId = user.cashGlAccountId;
                } else if (method?.glAccountId) {
                    // Priority 2: Use the Ledger account linked to this specific payment method
                    glAccountId = method.glAccountId;
                } else {
                    // Priority 3: Ultimate fallbacks
                    const isCashLike =
                        method?.isCash ||
                        activeMethodName?.toLowerCase() === "cash";
                    const accountName = isCashLike ? "Cash" : "Bank";
                    const [fallbackGl] = await tx
                        .select()
                        .from(glAccounts)
                        .where(eq(glAccounts.name, accountName))
                        .limit(1);
                    glAccountId = fallbackGl?.id || null;
                }

                if (glAccountId) {
                    await tx.insert(paymentAccounts).values({
                        paymentId: payment.id,
                        glAccountId: glAccountId,
                        amount: itemAmount,
                    });

                    // Create Payment Journal
                    const [paymentJournal] = await tx
                        .insert(journals)
                        .values({
                            transactionId: transaction.id,
                            date: payment.date,
                            description: `Pembayaran ${transaction.invoice}`,
                            status: "posted",
                        })
                        .returning();

                    // Dr Cash/Bank
                    await tx.insert(journalEntries).values({
                        journalId: paymentJournal.id,
                        glAccountId: glAccountId,
                        debit: itemAmount,
                        credit: 0,
                        note: `Penerimaan ${activeMethodName} ${transaction.invoice}`,
                    });

                    // Cr Receivable
                    const receivableAcc = await findGlAccountByCode("1300");
                    if (receivableAcc) {
                        await tx.insert(journalEntries).values({
                            journalId: paymentJournal.id,
                            glAccountId: receivableAcc,
                            debit: 0,
                            credit: arReduction,
                            note: `Pelunasan Piutang ${transaction.invoice}`,
                        });
                    }

                    // Cr Rounding (if cash)
                    if (roundAmount !== 0 && globalSettings?.roundingDifferenceGlAccountId) {
                        await tx.insert(journalEntries).values({
                            journalId: paymentJournal.id,
                            glAccountId: globalSettings.roundingDifferenceGlAccountId,
                            debit: roundAmount < 0 ? Math.abs(roundAmount) : 0,
                            credit: roundAmount > 0 ? roundAmount : 0,
                            note: `Selisih Pembulatan ${transaction.invoice}`,
                        });
                    }
                }
            }

            return transaction;
        });

        logAction(req, {
            action: "insert",
            table: "transactions",
            data: result,
            userId: req.user!.id,
            msg: `POS Checkout completed: ${result.invoice}`,
        });

        res.status(201).json(result);
    } catch (error) {
        console.error("POS Checkout error:", error);
        res.status(500).json({
            message: "Checkout failed",
            error: (error as Error).message,
        });
    }
}
