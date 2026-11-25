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
    productDetails,
    settings,
    vouchers,
    voucherUsages,
    priceGroups,
} from "@/db/schemas";
import { generateInvoice, generateJournalInvoice } from "@/helpers/generate-invoice";
import { updateStockForTransaction } from "@/repositories/stock.repository";
import { Request, Response } from "express";
import { eq, and, ilike, or, sql } from "drizzle-orm";
import { logAction } from "@/utils/log-helper";
import {
    findGlAccountByCode,
    getCogsGlAccountId,
    getInventoryGlAccountId,
    getAdminFeeGlAccountId,
    getAccountsReceivableGlAccountId,
    getSalesRevenueGlAccountId,
    getOutputTaxGlAccountId,
    requireGlAccount,
    AccountMappingRequiredError,
} from "@/repositories/gl-account.repository";
import { resolveBranchId, resolveBranchCode, resolveBranchCodeFromId } from "@/helpers/branch.helper";

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

        // 1.1 Idempotency Check: Prevent duplicate offline sync replay
        if (req.body.offlineInvoice) {
            const existing = await db
                .select()
                .from(transactions)
                .where(
                    and(
                        eq(transactions.type, "pos_sales"),
                        sql`${transactions.reference} LIKE ${`%${req.body.offlineInvoice}%`}`,
                    ),
                )
                .limit(1)
                .then((r) => r[0]);

            if (existing) {
                return res.status(200).json({
                    ...existing,
                    isIdempotentReplay: true,
                    offlineInvoice: req.body.offlineInvoice,
                    message: "Transaksi sudah tersimpan sebelumnya (idempotent replay)",
                });
            }
        }

        // 1.2 Price & Quantity Tamper Validation
        for (const item of details) {
            if (!item.qty || Number(item.qty) <= 0) {
                return res
                    .status(400)
                    .json({ message: "Kuantitas barang harus lebih dari 0" });
            }
            if (Number(item.price) < 0) {
                return res
                    .status(400)
                    .json({ message: "Harga jual barang tidak boleh negatif" });
            }
        }

        // 2. Get User for specific GL Account and Warehouse
        const user = await db
            .select()
            .from(users)
            .where(eq(users.id, req.user!.id))
            .limit(1)
            .then((r) => r[0]);

        // 3. Customer selection: from req.body.contactId, req.body.customerId, or fallback to General Customer
        let contactId = req.body.contactId || req.body.customerId;
        let customer: any = null;

        if (contactId) {
            customer = await db
                .select()
                .from(contacts)
                .where(eq(contacts.id, contactId))
                .limit(1)
                .then((r) => r[0]);
        }

        if (!customer) {
            customer = await db
                .select()
                .from(contacts)
                .where(
                    or(
                        eq(contacts.name, "General Customer"),
                        eq(contacts.name, "Pelanggan Umum"),
                    ),
                )
                .limit(1)
                .then((r) => r[0]);
            contactId = customer?.id;
        }

        if (!customer) {
            // Auto-fallback: get first customer contact in system
            customer = await db
                .select()
                .from(contacts)
                .limit(1)
                .then((r) => r[0]);
            contactId = customer?.id;
        }

        if (customer && !customer.priceGroupId) {
            const defaultPg = await db
                .select()
                .from(priceGroups)
                .where(eq(priceGroups.isActive, true))
                .limit(1)
                .then((r) => r[0]);
            if (defaultPg) {
                customer.priceGroupId = defaultPg.id;
            }
        }

        const termDays = Number(customer?.termOfPayment) || 0;
        let calculatedDueDate = req.body.dueDate;
        if (!calculatedDueDate) {
            const d = new Date();
            if (termDays > 0) {
                d.setDate(d.getDate() + termDays);
            }
            calculatedDueDate = d.toISOString().split("T")[0];
        }

        const result = await db.transaction(async (tx) => {
            const branchCode = await resolveBranchCode(req);
            const invoice = await generateInvoice("pos_sales", branchCode);

            const globalSettings = await tx.select().from(settings).where(eq(settings.id, "global")).limit(1).then(r => r[0]);
            const taxEnabled = globalSettings?.enableTax ?? true;
            const appliedTax = taxEnabled ? Number(totalTax || 0) : 0;
            const originalTotalAmount =
                Number(subtotal) - Number(totalDiscount) + appliedTax;
            const paidAmount =
                providedPaidAmount !== undefined
                    ? Number(providedPaidAmount)
                    : originalTotalAmount;
            let finalTotalAmount = originalTotalAmount;
            let roundingDifference = 0;

            if (globalSettings?.posRound2Digit) {
                finalTotalAmount = Math.ceil(originalTotalAmount / 100) * 100;
                roundingDifference = finalTotalAmount - originalTotalAmount;
            }

            // Validate TOP / DP according to Global Settings
            const isTempo =
                paidAmount === 0 ||
                (paymentMethod || "").toLowerCase().includes("tempo") ||
                (paymentMethod || "").toLowerCase().includes("bon") ||
                (paymentMethod || "").toLowerCase().includes("kredit") ||
                (paymentMethod || "").toLowerCase().includes("top");

            const isDownPayment =
                paidAmount > 0 &&
                paidAmount < finalTotalAmount &&
                ((paymentMethod || "").toLowerCase().includes("down") ||
                    (paymentMethod || "").toLowerCase().includes("deposit") ||
                    (paymentMethod || "").toLowerCase().includes("titipan") ||
                    (paymentMethod || "").toLowerCase().includes("dp"));

            if (isTempo && globalSettings && globalSettings.posAllowTop === false) {
                throw new Error(
                    "Penjualan bertempo (TOP / Bon / Kredit) dinonaktifkan di pengaturan POS.",
                );
            }

            if (
                isDownPayment &&
                globalSettings &&
                globalSettings.posAllowDownPayment === false
            ) {
                throw new Error(
                    "Penjualan Down Payment (DP / Uang Muka) dinonaktifkan di pengaturan POS.",
                );
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
                    totalTax: appliedTax,
                    totalAmount: originalTotalAmount,
                    status: paidAmount >= finalTotalAmount ? "paid" : "order",
                    userId: req.user!.id,
                    branchId: await resolveBranchId(undefined, req),
                    posSessionId,
                    reference: req.body.offlineInvoice
                        ? `${paymentMethod} [Offline Ref: ${req.body.offlineInvoice}]`
                        : paymentMethod,
                    note: req.body.offlineInvoice
                        ? `Sinkronisasi transaksi offline (Ref: ${req.body.offlineInvoice})`
                        : req.body.note,
                })
                .returning();

            // 5. Create Transaction Details
            const finalDetails = [];
            for (const d of details) {
                let pdId = d.productDetailId || d.id;

                // Fallback: If no detail ID provided, find level 1 for this product
                if (!pdId || pdId === "") {
                    const fallbackDetail = await tx
                        .select()
                        .from(productDetails)
                        .where(
                            and(
                                eq(productDetails.productId, d.productId),
                                eq(productDetails.level, 1),
                            ),
                        )
                        .limit(1)
                        .then((r) => r[0]);
                    pdId = fallbackDetail?.id;
                }

                if (!pdId) {
                    throw new Error(`Product detail not found for product ${d.productId}`);
                }

                const [detail] = await tx
                    .insert(transactionDetails)
                    .values({
                        transactionId: transaction.id,
                        productId: d.productId,
                        productDetailId: pdId,
                        warehouseId:
                            d.warehouseId || user?.posWarehouseId || null,
                        qty: d.qty,
                        price: d.price,
                        discount: d.discount,
                        amount: d.amount,
                        baseRatio: d.baseRatio || 1,
                        unitCost: d.unitCost || 0,
                        totalCost: d.totalCost || 0,
                        taxRate: taxEnabled ? d.taxRate || 0 : 0,
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

            // 7. Create Sales Journal (Validate required account mappings without fallback)
            const salesRevenueGlId = await requireGlAccount(getSalesRevenueGlAccountId, "Pendapatan Penjualan", tx);
            const arGlId = await requireGlAccount(getAccountsReceivableGlAccountId, "Piutang Usaha (AR)", tx);
            let salesTaxGlId: string | null = null;
            if (appliedTax > 0) {
                salesTaxGlId = await requireGlAccount(getOutputTaxGlAccountId, "PPN Keluaran", tx);
            }

            const salesJournalBranchId = await resolveBranchId(transaction.branchId, req);
            const salesJournalBranchCode = await resolveBranchCodeFromId(salesJournalBranchId);
            const salesJournalInvoice = await generateJournalInvoice("pos", salesJournalBranchCode, tx);
            const [salesJournal] = await tx
                .insert(journals)
                .values({
                    invoice: salesJournalInvoice,
                    transactionId: transaction.id,
                    branchId: salesJournalBranchId,
                    date: transaction.date,
                    description: `Penjualan ${transaction.invoice}`,
                    status: "posted",
                })
                .returning();

            // 1. Dr Piutang Usaha (AR)
            await tx.insert(journalEntries).values({
                journalId: salesJournal.id,
                glAccountId: arGlId,
                debit: originalTotalAmount,
                credit: 0,
                note: `Piutang Usaha ${transaction.invoice}`,
            });

            // 2. Cr Pendapatan Penjualan (Revenue / Net Subtotal)
            const netRevenue = subtotal - totalDiscount;
            if (netRevenue > 0) {
                await tx.insert(journalEntries).values({
                    journalId: salesJournal.id,
                    glAccountId: salesRevenueGlId,
                    debit: 0,
                    credit: netRevenue,
                    note: `Pendapatan Penjualan ${transaction.invoice}`,
                });
            }

            // 3. Cr PPN Keluaran
            if (appliedTax > 0 && salesTaxGlId) {
                await tx.insert(journalEntries).values({
                    journalId: salesJournal.id,
                    glAccountId: salesTaxGlId,
                    debit: 0,
                    credit: appliedTax,
                    note: `PPN Keluaran ${transaction.invoice}`,
                });
            }

            // COGS and Inventory for POS
            const totalCogs = finalDetails.reduce(
                (sum, d) => sum + Number(d.totalCost || 0),
                0,
            );

            if (totalCogs > 0) {
                const cogsGlId = await requireGlAccount(getCogsGlAccountId, "Beban Pokok Penjualan (HPP / COGS)", tx);
                const invGlId = await requireGlAccount(getInventoryGlAccountId, "Persediaan Barang (Inventory)", tx);

                await tx.insert(journalEntries).values({
                    journalId: salesJournal.id,
                    glAccountId: cogsGlId,
                    debit: totalCogs,
                    credit: 0,
                    note: `Beban Pokok Penjualan ${transaction.invoice}`,
                });
                await tx.insert(journalEntries).values({
                    journalId: salesJournal.id,
                    glAccountId: invGlId,
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
                    branchId: salesJournalBranchId,
                    type: "receivable",
                    dueDate: calculatedDueDate,
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

            const paymentDate = new Date().toISOString().split("T")[0];
            const paymentDebitEntries: Array<{
                glAccountId: string;
                amount: number;
                methodName: string;
            }> = [];
            const feeCreditEntries: Array<{
                glAccountId: string;
                amount: number;
                methodName: string;
            }> = [];
            let totalArReduction = 0;
            let totalRoundAmount = 0;
            let totalFeeAmount = 0;

            for (const item of paymentItems) {
                let itemAmount = Number(item.amount);
                if (itemAmount <= 0) continue;
                const activeMethodName = item.method;

                const [method] = await tx
                    .select()
                    .from(paymentMethods)
                    .where(
                        or(
                            ilike(paymentMethods.name, activeMethodName),
                            eq(paymentMethods.id, activeMethodName),
                        ),
                    )
                    .limit(1);

                // Admin Fee Calculation
                let feeAmount = 0;
                if (item.feeAmount !== undefined && item.feeAmount !== null && Number(item.feeAmount) >= 0) {
                    feeAmount = Number(item.feeAmount);
                } else if (method && Number(method.feePercentage) > 0) {
                    const feePct = Number(method.feePercentage);
                    feeAmount = Math.round((itemAmount * feePct) / (100 + feePct));
                }
                totalFeeAmount += feeAmount;

                // Create Payment Record
                const [payment] = await tx
                    .insert(payments)
                    .values({
                        contactId,
                        branchId: transaction.branchId,
                        date: paymentDate,
                        type: "receivable",
                        totalAmount: itemAmount,
                        feeAmount: feeAmount,
                        status: "posted",
                        reference: activeMethodName,
                        posSessionId,
                    })
                    .returning();

                // Record Payment Account (Ledger hit)
                let glAccountId: string | null = null;

                // Link Payment to Invoice
                // Calculate how much of this payment goes to reducing the AR
                let arReduction = Math.max(0, itemAmount - feeAmount);
                let roundAmount = 0;

                if (globalSettings?.posRound2Digit && method?.isCash) {
                    // Apply rounding logic to the AR reduction vs actual cash received
                    roundAmount = roundingDifference;
                    arReduction = Math.max(0, arReduction - roundingDifference);
                }

                totalArReduction += arReduction;
                totalRoundAmount += roundAmount;

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
                        activeMethodName?.toLowerCase() === "cash" ||
                        activeMethodName?.toLowerCase().includes("cash") ||
                        activeMethodName?.toLowerCase().includes("tunai") ||
                        activeMethodName?.toLowerCase().includes("down") ||
                        activeMethodName?.toLowerCase().includes("deposit");
                    const accountName = isCashLike ? "Cash" : "Bank";
                    let [fallbackGl] = await tx
                        .select()
                        .from(glAccounts)
                        .where(eq(glAccounts.name, accountName))
                        .limit(1);
                    if (!fallbackGl && isCashLike) {
                        [fallbackGl] = await tx
                            .select()
                            .from(glAccounts)
                            .where(eq(glAccounts.code, "1110"))
                            .limit(1);
                    }
                    glAccountId = fallbackGl?.id || null;
                }

                if (glAccountId) {
                    await tx.insert(paymentAccounts).values({
                        paymentId: payment.id,
                        glAccountId: glAccountId,
                        amount: itemAmount,
                    });

                    paymentDebitEntries.push({
                        glAccountId,
                        amount: itemAmount,
                        methodName: activeMethodName,
                    });
                }

                if (feeAmount > 0) {
                    const feeGlId = await getAdminFeeGlAccountId(method?.feeGlAccountId, tx);
                    if (feeGlId) {
                        feeCreditEntries.push({
                            glAccountId: feeGlId,
                            amount: feeAmount,
                            methodName: activeMethodName,
                        });
                    }
                }
            }

            // Create ONE Consolidated Payment Journal if there are payments
            if (paymentDebitEntries.length > 0) {
                const paymentJournalBranchId = await resolveBranchId(transaction.branchId, req);
                const paymentJournalBranchCode = await resolveBranchCodeFromId(paymentJournalBranchId);
                const paymentJournalInvoice = await generateJournalInvoice("ar_payment", paymentJournalBranchCode, tx);
                const [paymentJournal] = await tx
                    .insert(journals)
                    .values({
                        invoice: paymentJournalInvoice,
                        transactionId: transaction.id,
                        branchId: paymentJournalBranchId,
                        date: paymentDate,
                        description: `Pembayaran ${transaction.invoice}`,
                        status: "posted",
                    })
                    .returning();

                // 1. Dr Cash/Bank for each payment method
                for (const debitEntry of paymentDebitEntries) {
                    await tx.insert(journalEntries).values({
                        journalId: paymentJournal.id,
                        glAccountId: debitEntry.glAccountId,
                        debit: debitEntry.amount,
                        credit: 0,
                        note: `Penerimaan ${debitEntry.methodName} ${transaction.invoice}`,
                    });
                }

                // 2. Cr Receivable for total AR reduction
                const receivableAcc = await getAccountsReceivableGlAccountId(tx);
                if (receivableAcc && totalArReduction > 0) {
                    await tx.insert(journalEntries).values({
                        journalId: paymentJournal.id,
                        glAccountId: receivableAcc,
                        debit: 0,
                        credit: totalArReduction,
                        note: `Pelunasan Piutang ${transaction.invoice}`,
                    });
                }

                // 3. Cr Admin Fee Revenue
                for (const feeEntry of feeCreditEntries) {
                    await tx.insert(journalEntries).values({
                        journalId: paymentJournal.id,
                        glAccountId: feeEntry.glAccountId,
                        debit: 0,
                        credit: feeEntry.amount,
                        note: `Biaya Layanan Admin (${feeEntry.methodName}) ${transaction.invoice}`,
                    });
                }

                // 4. Cr/Dr Rounding Difference if applicable
                if (totalRoundAmount !== 0 && globalSettings?.roundingDifferenceGlAccountId) {
                    await tx.insert(journalEntries).values({
                        journalId: paymentJournal.id,
                        glAccountId: globalSettings.roundingDifferenceGlAccountId,
                        debit: totalRoundAmount < 0 ? Math.abs(totalRoundAmount) : 0,
                        credit: totalRoundAmount > 0 ? totalRoundAmount : 0,
                        note: `Selisih Pembulatan ${transaction.invoice}`,
                    });
                }

                // Sync open invoice paid amount with actual AR reduction
                const effectiveArPaid = Math.min(originalTotalAmount, totalArReduction);
                await tx.update(openInvoices)
                    .set({
                        paidAmount: effectiveArPaid,
                        status:
                            effectiveArPaid >= originalTotalAmount
                                ? "paid"
                                : effectiveArPaid > 0
                                  ? "partial"
                                  : "open",
                    })
                    .where(eq(openInvoices.id, openInvoice.id));
            }

            // 8. CRM Voucher Usage & Member Loyalty Points
            if (req.body.voucherId) {
                await tx.insert(voucherUsages).values({
                    voucherId: req.body.voucherId,
                    transactionId: transaction.id,
                    contactId: customer?.id || null,
                    discountAmount: String(req.body.voucherDiscount || totalDiscount || 0),
                });
                await tx.update(vouchers)
                    .set({ usedCount: sql`${vouchers.usedCount} + 1` })
                    .where(eq(vouchers.id, req.body.voucherId));
            }

            let earnedPoints = 0;
            if (customer?.isMember) {
                earnedPoints = Math.floor(Number(transaction.totalAmount) / 10000);
                if (earnedPoints > 0) {
                    await tx.update(contacts)
                        .set({ points: sql`${contacts.points} + ${earnedPoints}` })
                        .where(eq(contacts.id, customer.id));
                }
            }

            return {
                ...transaction,
                customerName: customer?.name || "General Customer",
                customerPhone: customer?.phone || "",
                offlineInvoice: req.body.offlineInvoice,
                earnedPoints,
                feeAmount: totalFeeAmount,
                payments: paymentItems,
            };
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

export async function getOpenPosInvoices(req: Request, res: Response) {
    try {
        const search = ((req.query.search as string) || "").trim();
        const branchId = await resolveBranchId(undefined, req);

        const conditions = [
            eq(openInvoices.type, "receivable"),
            eq(transactions.type, "pos_sales"),
            or(eq(openInvoices.status, "open"), eq(openInvoices.status, "partial")),
        ];

        if (branchId) {
            conditions.push(eq(openInvoices.branchId, branchId));
        }

        const list = await db
            .select({
                id: openInvoices.id,
                transactionId: openInvoices.transactionId,
                invoice: transactions.invoice,
                date: transactions.date,
                dueDate: openInvoices.dueDate,
                contactId: openInvoices.contactId,
                customerName: contacts.name,
                customerPhone: contacts.phone,
                amount: openInvoices.amount,
                paidAmount: openInvoices.paidAmount,
                status: openInvoices.status,
            })
            .from(openInvoices)
            .innerJoin(transactions, eq(openInvoices.transactionId, transactions.id))
            .leftJoin(contacts, eq(openInvoices.contactId, contacts.id))
            .where(and(...conditions))
            .orderBy(openInvoices.dueDate, transactions.date);

        const filtered = search
            ? list.filter(
                  (item) =>
                      item.invoice?.toLowerCase().includes(search.toLowerCase()) ||
                      item.customerName?.toLowerCase().includes(search.toLowerCase()) ||
                      item.customerPhone?.toLowerCase().includes(search.toLowerCase()),
              )
            : list;

        const transformed = filtered.map((item) => ({
            ...item,
            amount: Number(item.amount),
            paidAmount: Number(item.paidAmount),
            remainingAmount: Math.max(0, Number(item.amount) - Number(item.paidAmount)),
        }));

        res.json(transformed);
    } catch (error) {
        console.error("Error fetching open POS invoices:", error);
        res.status(500).json({ message: "Failed to fetch open invoices" });
    }
}

export async function settlePosInvoice(req: Request, res: Response) {
    const { openInvoiceId, amount, paymentMethod, posSessionId } = req.body;

    if (!openInvoiceId || !amount || Number(amount) <= 0) {
        return res.status(400).json({ message: "Invalid invoice or amount" });
    }

    try {
        const settleAmount = Number(amount);

        if (posSessionId) {
            const session = await db
                .select()
                .from(posSessions)
                .where(and(eq(posSessions.id, posSessionId), eq(posSessions.status, "open")))
                .limit(1)
                .then((r) => r[0]);
            if (!session) {
                return res.status(400).json({ message: "Active POS session required" });
            }
        }

        const user = await db
            .select()
            .from(users)
            .where(eq(users.id, req.user!.id))
            .limit(1)
            .then((r) => r[0]);

        const result = await db.transaction(async (tx) => {
            const [openInvoice] = await tx
                .select()
                .from(openInvoices)
                .where(eq(openInvoices.id, openInvoiceId))
                .limit(1);

            if (!openInvoice) {
                throw new Error("Open invoice not found");
            }

            const currentPaid = Number(openInvoice.paidAmount || 0);
            const total = Number(openInvoice.amount || 0);
            const remaining = total - currentPaid;

            if (settleAmount > remaining + 0.01) {
                throw new Error(`Amount exceeds remaining balance (${remaining})`);
            }

            const [transaction] = openInvoice.transactionId
                ? await tx
                      .select()
                      .from(transactions)
                      .where(eq(transactions.id, openInvoice.transactionId))
                      .limit(1)
                : [null];

            if (!transaction || transaction.type !== "pos_sales") {
                throw new Error("Hanya nota transaksi POS yang dapat dilunasi di kasir POS");
            }

            const [payment] = await tx
                .insert(payments)
                .values({
                    contactId: openInvoice.contactId,
                    branchId: openInvoice.branchId,
                    date: new Date().toISOString().split("T")[0],
                    type: "receivable",
                    totalAmount: settleAmount,
                    status: "posted",
                    reference: paymentMethod || "Cash",
                    posSessionId: posSessionId || null,
                })
                .returning();

            await tx.insert(paymentLines).values({
                paymentId: payment.id,
                openInvoiceId: openInvoice.id,
                amount: settleAmount,
            });

            const newPaid = currentPaid + settleAmount;
            const newStatus = newPaid >= total ? "paid" : "partial";
            await tx
                .update(openInvoices)
                .set({
                    paidAmount: newPaid,
                    status: newStatus,
                    updatedAt: new Date(),
                })
                .where(eq(openInvoices.id, openInvoice.id));

            if (newStatus === "paid" && transaction) {
                await tx
                    .update(transactions)
                    .set({
                        status: "paid",
                        updatedAt: new Date(),
                    })
                    .where(eq(transactions.id, transaction.id));
            }

            let glAccountId: string | null = null;
            const activeMethodName = paymentMethod || "Cash";

            const [method] = await tx
                .select()
                .from(paymentMethods)
                .where(ilike(paymentMethods.name, activeMethodName))
                .limit(1);

            if (method?.isCash && user?.cashGlAccountId) {
                glAccountId = user.cashGlAccountId;
            } else if (method?.glAccountId) {
                glAccountId = method.glAccountId;
            } else {
                const isCashLike =
                    method?.isCash ||
                    activeMethodName?.toLowerCase().includes("cash") ||
                    activeMethodName?.toLowerCase().includes("tunai");
                const accountName = isCashLike ? "Cash" : "Bank";
                let [fallbackGl] = await tx
                    .select()
                    .from(glAccounts)
                    .where(eq(glAccounts.name, accountName))
                    .limit(1);
                if (!fallbackGl && isCashLike) {
                    [fallbackGl] = await tx
                        .select()
                        .from(glAccounts)
                        .where(eq(glAccounts.code, "1110"))
                        .limit(1);
                }
                glAccountId = fallbackGl?.id || null;
            }

            if (glAccountId) {
                await tx.insert(paymentAccounts).values({
                    paymentId: payment.id,
                    glAccountId: glAccountId,
                    amount: settleAmount,
                });

                const paymentJournalBranchId = await resolveBranchId(openInvoice.branchId, req);
                const paymentJournalBranchCode = await resolveBranchCodeFromId(paymentJournalBranchId);
                const paymentJournalInvoice = await generateJournalInvoice("ar_payment", paymentJournalBranchCode, tx);
                const [paymentJournal] = await tx
                    .insert(journals)
                    .values({
                        invoice: paymentJournalInvoice,
                        transactionId: transaction?.id,
                        branchId: paymentJournalBranchId,
                        date: payment.date,
                        description: `Pelunasan Piutang POS ${transaction?.invoice || ""}`,
                        status: "posted",
                    })
                    .returning();

                await tx.insert(journalEntries).values({
                    journalId: paymentJournal.id,
                    glAccountId: glAccountId,
                    debit: settleAmount,
                    credit: 0,
                    note: `Penerimaan Pelunasan ${activeMethodName} ${transaction?.invoice || ""}`,
                });

                const receivableAcc = await getAccountsReceivableGlAccountId(tx);
                if (receivableAcc) {
                    await tx.insert(journalEntries).values({
                        journalId: paymentJournal.id,
                        glAccountId: receivableAcc,
                        debit: 0,
                        credit: settleAmount,
                        note: `Pengurangan Piutang ${transaction?.invoice || ""}`,
                    });
                }
            }

            let customerName = "Pelanggan";
            if (openInvoice.contactId) {
                const [cust] = await tx
                    .select({ name: contacts.name })
                    .from(contacts)
                    .where(eq(contacts.id, openInvoice.contactId))
                    .limit(1);
                if (cust) customerName = cust.name;
            }

            return {
                paymentId: payment.id,
                invoice: transaction?.invoice,
                customerName,
                previousPaid: currentPaid,
                amountPaid: settleAmount,
                totalAmount: total,
                remainingAmount: Math.max(0, total - newPaid),
                status: newStatus,
                date: payment.date,
                paymentMethod: activeMethodName,
            };
        });

        logAction(req, {
            action: "insert",
            table: "payments",
            data: result,
            userId: req.user!.id,
            msg: `POS Invoice settled: ${result.invoice} (${result.amountPaid})`,
        });

        res.status(200).json(result);
    } catch (error) {
        console.error("POS Settle error:", error);
        res.status(500).json({
            message: "Settlement failed",
            error: (error as Error).message,
        });
    }
}

export async function recordAuditLog(req: Request, res: Response) {
    try {
        const { eventType, details, sessionId } = req.body;
        logAction(req, {
            action: "delete",
            table: "pos_cart_void",
            data: { eventType, details, sessionId },
            userId: req.user!.id,
            msg: `[POS Anti-Fraud] ${eventType || "Item Void"}: ${JSON.stringify(details || {})}`,
        });
        res.status(200).json({ status: "logged" });
    } catch (err: any) {
        res.status(500).json({ message: "Failed to record audit log" });
    }
}
