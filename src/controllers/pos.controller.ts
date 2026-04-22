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
} from "@/db/schemas";
import { generateInvoice } from "@/helpers/generate-invoice";
import { updateStockForTransaction } from "@/repositories/stock.repository";
import { Request, Response } from "express";
import { eq, and, ilike } from "drizzle-orm";
import { logAction } from "@/utils/log-helper";

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

    const paidAmount = providedPaidAmount !== undefined ? Number(providedPaidAmount) : totalAmount;

    try {
        // 1. Validate POS Session
        const session = await db
            .select()
            .from(posSessions)
            .where(
                and(
                    eq(posSessions.id, posSessionId),
                    eq(posSessions.status, "open")
                )
            )
            .limit(1)
            .then(r => r[0]);

        if (!session) {
            return res.status(400).json({ message: "Active POS session is required" });
        }

        // 2. Get User for specific GL Account
        const user = await db
            .select()
            .from(users)
            .where(eq(users.id, req.user!.id))
            .limit(1)
            .then(r => r[0]);

        // 3. Get Default Customer (General Customer)
        const customer = await db
            .select()
            .from(contacts)
            .where(eq(contacts.name, "General Customer"))
            .limit(1)
            .then(r => r[0]);

        const contactId = customer?.id;

        const result = await db.transaction(async (tx) => {
            const invoice = await generateInvoice("pos_sales");

            // 4. Create Transaction
            const [transaction] = await tx
                .insert(transactions)
                .values({
                    type: "pos_sales",
                    invoice,
                    contactId,
                    date: new Date().toISOString().split('T')[0],
                    subtotal,
                    totalDiscount,
                    totalTax,
                    totalAmount,
                    status: paidAmount >= totalAmount ? "paid" : "order",
                    userId: req.user!.id,
                    posSessionId,
                    reference: paymentMethod,
                })
                .returning();

            // 5. Create Transaction Details
            for (const d of details) {
                await tx.insert(transactionDetails).values({
                    transactionId: transaction.id,
                    productId: d.productId,
                    productDetailId: d.productDetailId || d.id,
                    warehouseId: d.warehouseId || null,
                    qty: d.qty,
                    price: d.price,
                    discount: d.discount,
                    amount: d.amount,
                    baseRatio: d.baseRatio,
                    unitCost: d.unitCost,
                    totalCost: d.totalCost,
                    taxRate: d.taxRate,
                    movementType: -1, // OUT
                });
            }

            // 6. Update Stock
            const transDetails = details.map((d: any) => ({
                productId: d.productId,
                warehouseId: d.warehouseId || null,
                qty: d.qty,
                baseRatio: d.baseRatio,
                movementType: -1, // OUT
                unitCost: d.unitCost,
            }));
            await updateStockForTransaction(transaction.id, "pos_sales", transDetails, tx as any);

            // 7. Handle Payment
            // Create Open Invoice
            const [openInvoice] = await tx.insert(openInvoices).values({
                transactionId: transaction.id,
                contactId,
                type: "receivable",
                dueDate: new Date().toISOString().split('T')[0],
                amount: totalAmount,
                paidAmount: paidAmount,
                status: paidAmount >= totalAmount ? "paid" : (paidAmount > 0 ? "partial" : "open"),
            }).returning();

            // Process payments (support multiple payments for split payment feature)
            const paymentItems = req.body.payments || [
                { method: paymentMethod, amount: paidAmount }
            ];

            for (const item of paymentItems) {
                const itemAmount = Number(item.amount);
                if (itemAmount <= 0) continue;

                // Create Payment
                const [payment] = await tx.insert(payments).values({
                    contactId,
                    date: new Date().toISOString().split('T')[0],
                    type: "receivable",
                    totalAmount: itemAmount,
                    status: "posted",
                }).returning();

                // Link Payment to Invoice
                await tx.insert(paymentLines).values({
                    paymentId: payment.id,
                    openInvoiceId: openInvoice.id,
                    amount: itemAmount,
                });

                // Record Payment Account (Ledger hit)
                let glAccountId: string | null = null;
                const activeMethodName = item.method;

                const [method] = await tx
                    .select()
                    .from(paymentMethods)
                    .where(ilike(paymentMethods.name, activeMethodName))
                    .limit(1);

                // Priority 1: If method is marked as 'isCash', try user's specific cashier account
                if (method?.isCash && user?.cashGlAccountId) {
                    glAccountId = user.cashGlAccountId;
                } else if (method?.glAccountId) {
                    // Priority 2: Use the Ledger account linked to this specific payment method
                    glAccountId = method.glAccountId;
                } else {
                    // Priority 3: Ultimate fallbacks
                    const isCashLike = method?.isCash || activeMethodName?.toLowerCase() === "cash";
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
        res.status(500).json({ message: "Checkout failed", error: (error as Error).message });
    }
}
