import { Request, Response } from "express";
import { db } from "@/db";
import {
    journals,
    journalEntries,
    transactions,
    transactionDetails,
    stocks,
    stockMovements,
    openInvoices,
    glAccounts,
    accountMappings,
    products,
    warehouses,
    branches,
    settings,
} from "@/db/schemas";
import { sql, eq, and, or, inArray, isNull, notInArray } from "drizzle-orm";
import { generateJournalInvoice } from "@/helpers/generate-invoice";
import { resolveBranchCodeFromId, resolveBranchId } from "@/helpers/branch.helper";
import { updateStockForTransaction } from "@/repositories/stock.repository";
import { addDays } from "@/helpers/add-days";
import { logger } from "@/logger";

export interface AuditIssue {
    id: string;
    category:
        | "journal_balance"
        | "transaction_journal"
        | "stock_integrity"
        | "orphan_record"
        | "open_invoice";
    type: string;
    reference: string;
    date?: string | null;
    description: string;
    expectedValue?: string | number | null;
    actualValue?: string | number | null;
    difference?: number | null;
    canAutoFix: boolean;
    fixAction?: string;
    details?: any;
}

export async function getDataIntegrityAudit(req: Request, res: Response) {
    try {
        const issues: AuditIssue[] = [];

        // -------------------------------------------------------------
        // 1. KESEIMBANGAN JURNAL (Debit vs Kredit)
        // -------------------------------------------------------------
        const unbalancedJournalsRes = await db.execute(sql`
            SELECT 
                j.id, 
                j.invoice, 
                j.date, 
                j.status,
                COUNT(je.id) as entry_count,
                COALESCE(SUM(je.debit), 0)::numeric as total_debit,
                COALESCE(SUM(je.credit), 0)::numeric as total_credit,
                ABS(COALESCE(SUM(je.debit), 0) - COALESCE(SUM(je.credit), 0))::numeric as diff
            FROM journals j
            LEFT JOIN journal_entries je ON je.journal_id = j.id
            GROUP BY j.id, j.invoice, j.date, j.status
            HAVING ABS(COALESCE(SUM(je.debit), 0) - COALESCE(SUM(je.credit), 0)) > 0.01
                OR COUNT(je.id) = 0
            ORDER BY j.date DESC;
        `);

        for (const row of unbalancedJournalsRes.rows as any[]) {
            const isZeroEntries = Number(row.entry_count) === 0;
            issues.push({
                id: row.id,
                category: "journal_balance",
                type: isZeroEntries ? "empty_journal" : "unbalanced_journal",
                reference: row.invoice,
                date: row.date,
                description: isZeroEntries
                    ? `Jurnal ${row.invoice} tidak memiliki baris jurnal (kosong)`
                    : `Jurnal ${row.invoice} tidak seimbang: Total Debit (Rp ${Number(row.total_debit).toLocaleString()}) != Total Kredit (Rp ${Number(row.total_credit).toLocaleString()})`,
                expectedValue: row.total_debit,
                actualValue: row.total_credit,
                difference: Number(row.diff || 0),
                canAutoFix: false,
                details: row,
            });
        }

        // -------------------------------------------------------------
        // 2. INTEGRITAS TRANSAKSI VS JURNAL
        // -------------------------------------------------------------
        // a. Transaksi Posted Tanpa Jurnal
        const postedWithoutJournalsRes = await db.execute(sql`
            SELECT t.id, t.type, t.invoice, t.date, t.total_amount, t.status, b.name as branch_name
            FROM transactions t
            LEFT JOIN journals j ON j.transaction_id = t.id
            LEFT JOIN branches b ON b.id = t.branch_id
            WHERE t.status = 'posted'
              AND t.type IN ('sales', 'purchase', 'sales_return', 'purchase_return', 'adjustment')
              AND j.id IS NULL
            ORDER BY t.date DESC;
        `);

        for (const row of postedWithoutJournalsRes.rows as any[]) {
            issues.push({
                id: row.id,
                category: "transaction_journal",
                type: "missing_journal",
                reference: row.invoice,
                date: row.date,
                description: `Transaksi ${row.type.toUpperCase()} #${row.invoice} sudah posted tetapi belum dibuatkan jurnal akuntansi`,
                expectedValue: "posted",
                actualValue: "missing",
                difference: Number(row.total_amount || 0),
                canAutoFix: true,
                fixAction: "regenerate_journal",
                details: { transactionId: row.id, type: row.type },
            });
        }

        // b. Draft Journal pada Transaksi Posted
        const draftJournalsOnPostedTrxRes = await db.execute(sql`
            SELECT j.id, j.invoice as journal_invoice, t.id as trx_id, t.invoice as trx_invoice, t.type as trx_type, j.date, j.status as journal_status
            FROM journals j
            JOIN transactions t ON t.id = j.transaction_id
            WHERE t.status = 'posted' AND j.status = 'draft'
            ORDER BY j.date DESC;
        `);

        for (const row of draftJournalsOnPostedTrxRes.rows as any[]) {
            issues.push({
                id: row.id,
                category: "transaction_journal",
                type: "draft_journal_on_posted_trx",
                reference: `${row.trx_invoice} (${row.journal_invoice})`,
                date: row.date,
                description: `Transaksi #${row.trx_invoice} sudah posted namun jurnal #${row.journal_invoice} masih berstatus draft`,
                expectedValue: "posted",
                actualValue: "draft",
                canAutoFix: true,
                fixAction: "post_draft_journal",
                details: { journalId: row.id },
            });
        }

        // c. Transaksi Dibatalkan tapi Jurnal Masih Aktif
        const cancelledTrxActiveJournalRes = await db.execute(sql`
            SELECT j.id, j.invoice as journal_invoice, t.id as trx_id, t.invoice as trx_invoice, j.date, j.status as journal_status
            FROM journals j
            JOIN transactions t ON t.id = j.transaction_id
            WHERE t.status = 'cancelled' AND j.status != 'cancelled'
            ORDER BY j.date DESC;
        `);

        for (const row of cancelledTrxActiveJournalRes.rows as any[]) {
            issues.push({
                id: row.id,
                category: "transaction_journal",
                type: "cancelled_trx_active_journal",
                reference: `${row.trx_invoice} (${row.journal_invoice})`,
                date: row.date,
                description: `Transaksi #${row.trx_invoice} dibatalkan (cancelled) namun jurnal #${row.journal_invoice} masih berstatus ${row.journal_status}`,
                expectedValue: "cancelled",
                actualValue: row.journal_status,
                canAutoFix: true,
                fixAction: "cancel_journal",
                details: { journalId: row.id },
            });
        }

        // -------------------------------------------------------------
        // 3. INTEGRITAS STOK VS MUTASI (stocks vs stock_movements)
        // -------------------------------------------------------------
        // a. Saldo Stok Drift (Selisih stocks.qty dengan akumulasi pergerakan riil)
        const stockDriftRes = await db.execute(sql`
            SELECT 
                s.id as stock_id, 
                p.id as product_id,
                p.name as product_name, 
                COALESCE(w.name, 'Gudang Utama') as warehouse_name,
                s.batch_number,
                s.qty::numeric as cached_qty,
                COALESCE(SUM(
                    CASE 
                        WHEN sm.type = 'IN' THEN ABS(sm.quantity)
                        WHEN sm.type = 'OUT' THEN -ABS(sm.quantity)
                        ELSE sm.quantity
                    END
                ), 0)::numeric as calculated_qty,
                (s.qty - COALESCE(SUM(
                    CASE 
                        WHEN sm.type = 'IN' THEN ABS(sm.quantity)
                        WHEN sm.type = 'OUT' THEN -ABS(sm.quantity)
                        ELSE sm.quantity
                    END
                ), 0))::numeric as diff
            FROM stocks s
            JOIN products p ON p.id = s.product_id
            LEFT JOIN warehouses w ON w.id = s.warehouse_id
            LEFT JOIN stock_movements sm ON sm.stock_id = s.id
            GROUP BY s.id, p.id, p.name, w.name, s.batch_number, s.qty
            HAVING ABS(s.qty - COALESCE(SUM(
                CASE 
                    WHEN sm.type = 'IN' THEN ABS(sm.quantity)
                    WHEN sm.type = 'OUT' THEN -ABS(sm.quantity)
                    ELSE sm.quantity
                END
            ), 0)) > 0.001
            ORDER BY ABS(s.qty - COALESCE(SUM(
                CASE 
                    WHEN sm.type = 'IN' THEN ABS(sm.quantity)
                    WHEN sm.type = 'OUT' THEN -ABS(sm.quantity)
                    ELSE sm.quantity
                END
            ), 0)) DESC;
        `);

        for (const row of stockDriftRes.rows as any[]) {
            issues.push({
                id: row.stock_id,
                category: "stock_integrity",
                type: "stock_drift",
                reference: `${row.product_name} [${row.warehouse_name}]`,
                description: `Saldo stok master (${Number(row.cached_qty).toLocaleString()}) tidak sinkron dengan riwayat akumulasi mutasi (${Number(row.calculated_qty).toLocaleString()})`,
                expectedValue: Number(row.calculated_qty),
                actualValue: Number(row.cached_qty),
                difference: Math.abs(Number(row.diff || 0)),
                canAutoFix: true,
                fixAction: "recalculate_stock",
                details: { stockId: row.stock_id, correctQty: Number(row.calculated_qty) },
            });
        }

        // b. Transaksi Posted Tanpa Mutasi Stok atau Mutasi Tidak Lengkap
        const postedWithoutMovementsRes = await db.execute(sql`
            SELECT 
                t.id, 
                t.type, 
                t.invoice, 
                t.date,
                COUNT(DISTINCT td.id) as expected_items,
                COUNT(DISTINCT sm.id) as actual_movements,
                COALESCE(SUM(td.qty * td.base_ratio), 0)::numeric as expected_qty,
                COALESCE(SUM(ABS(sm.quantity)), 0)::numeric as actual_qty
            FROM transactions t
            JOIN transaction_details td ON td.transaction_id = t.id
            LEFT JOIN stock_movements sm ON sm.transaction_id = t.id
            WHERE t.status = 'posted'
              AND t.type IN ('sales', 'purchase', 'sales_return', 'purchase_return', 'adjustment', 'transfer_stock')
            GROUP BY t.id, t.type, t.invoice, t.date
            HAVING COUNT(DISTINCT sm.id) = 0 
                OR COUNT(DISTINCT sm.id) < COUNT(DISTINCT td.id)
                OR ABS(COALESCE(SUM(td.qty * td.base_ratio), 0) - COALESCE(SUM(ABS(sm.quantity)), 0)) > 0.01
            ORDER BY t.date DESC;
        `);

        for (const row of postedWithoutMovementsRes.rows as any[]) {
            const actualMov = Number(row.actual_movements || 0);
            const expItems = Number(row.expected_items || 0);
            const expQty = Number(row.expected_qty || 0);
            const actQty = Number(row.actual_qty || 0);
            const diffQty = Math.abs(expQty - actQty);

            let desc = "";
            if (actualMov === 0) {
                desc = `Transaksi posted #${row.invoice} (${row.type.toUpperCase()}) berisi ${expItems} barang tetapi tidak memiliki catatan mutasi stok`;
            } else if (actualMov < expItems) {
                desc = `Transaksi posted #${row.invoice} (${row.type.toUpperCase()}) mutasi stok tidak lengkap (${actualMov} dari ${expItems} barang tercatat)`;
            } else {
                desc = `Transaksi posted #${row.invoice} (${row.type.toUpperCase()}) kuantitas barang (${expQty}) tidak sesuai dengan mutasi stok (${actQty})`;
            }

            issues.push({
                id: row.id,
                category: "stock_integrity",
                type: "missing_stock_movement",
                reference: row.invoice,
                date: row.date,
                description: desc,
                expectedValue: `${expQty} unit (${expItems} item)`,
                actualValue: `${actQty} unit (${actualMov} item)`,
                difference: diffQty,
                canAutoFix: true,
                fixAction: "recreate_stock_movements",
                details: { transactionId: row.id, type: row.type },
            });
        }

        // c. Stok Negatif (Stok Minus)
        const negativeStocksRes = await db.execute(sql`
            SELECT s.id, p.name as product_name, COALESCE(w.name, 'Gudang Utama') as warehouse_name, s.qty::numeric as qty, s.batch_number
            FROM stocks s
            JOIN products p ON p.id = s.product_id
            LEFT JOIN warehouses w ON w.id = s.warehouse_id
            WHERE s.qty < 0
            ORDER BY s.qty ASC;
        `);

        for (const row of negativeStocksRes.rows as any[]) {
            issues.push({
                id: row.id,
                category: "stock_integrity",
                type: "negative_stock",
                reference: `${row.product_name} [${row.warehouse_name}]`,
                description: `Stok gudang bernilai negatif (${Number(row.qty).toLocaleString()}). Penjualan melebihi ketersediaan fisik.`,
                expectedValue: ">= 0",
                actualValue: Number(row.qty),
                difference: Math.abs(Number(row.qty)),
                canAutoFix: false,
                details: { stockId: row.id },
            });
        }

        // -------------------------------------------------------------
        // 4. DETEKSI RECORD ORPHAN (Yatim Tanpa Relasi)
        // -------------------------------------------------------------
        // a. Jurnal Orphan (terhubung ke transaksi yang tidak ada)
        const orphanJournalsRes = await db.execute(sql`
            SELECT j.id, j.invoice, j.date, j.status, j.transaction_id
            FROM journals j
            LEFT JOIN transactions t ON t.id = j.transaction_id
            WHERE j.transaction_id IS NOT NULL AND t.id IS NULL;
        `);

        for (const row of orphanJournalsRes.rows as any[]) {
            issues.push({
                id: row.id,
                category: "orphan_record",
                type: "orphan_journal",
                reference: row.invoice,
                date: row.date,
                description: `Jurnal #${row.invoice} terikat ke ID transaksi yang sudah terhapus dari sistem`,
                canAutoFix: true,
                fixAction: "delete_orphan_journal",
                details: { journalId: row.id },
            });
        }

        // b. Baris Jurnal (journal_entries) Tanpa Parent Jurnal atau GL Account
        const orphanEntriesRes = await db.execute(sql`
            SELECT je.id, je.journal_id, je.account_id, je.debit, je.credit, je.note
            FROM journal_entries je
            LEFT JOIN journals j ON j.id = je.journal_id
            LEFT JOIN gl_accounts gl ON gl.id = je.account_id
            WHERE j.id IS NULL OR gl.id IS NULL;
        `);

        for (const row of orphanEntriesRes.rows as any[]) {
            issues.push({
                id: row.id,
                category: "orphan_record",
                type: "orphan_journal_entry",
                reference: `Entry #${row.id.slice(0, 8)}`,
                description: `Baris entri debit/kredit tidak memiliki relasi jurnal atau akun GL yang valid`,
                canAutoFix: true,
                fixAction: "delete_orphan_entry",
                details: { entryId: row.id },
            });
        }

        // c. Mutasi Stok Tanpa Transaksi
        const orphanMovementsRes = await db.execute(sql`
            SELECT sm.id, sm.stock_id, sm.quantity, sm.type, sm.transaction_id, sm.created_at
            FROM stock_movements sm
            LEFT JOIN transactions t ON t.id = sm.transaction_id
            WHERE sm.transaction_id IS NOT NULL AND t.id IS NULL;
        `);

        for (const row of orphanMovementsRes.rows as any[]) {
            issues.push({
                id: row.id,
                category: "orphan_record",
                type: "orphan_stock_movement",
                reference: `Mutasi #${row.id.slice(0, 8)}`,
                description: `Pergerakan stok ${row.type} (${row.quantity}) terikat ke transaksi yang sudah tidak ada`,
                canAutoFix: true,
                fixAction: "delete_orphan_movement",
                details: { movementId: row.id },
            });
        }

        // -------------------------------------------------------------
        // 5. INTEGRITAS FAKTUR TERBUKA (Open Invoices AR / AP)
        // -------------------------------------------------------------
        // a. Selisih Nilai Open Invoice dengan Total Transaksi
        const openInvoiceMismatchRes = await db.execute(sql`
            SELECT oi.id, oi.transaction_id, oi.type, oi.amount::numeric as oi_amount, oi.paid_amount::numeric as oi_paid, t.invoice, t.total_amount::numeric as trx_total, t.date
            FROM open_invoices oi
            JOIN transactions t ON t.id = oi.transaction_id
            WHERE ABS(oi.amount - t.total_amount) > 0.01
            ORDER BY t.date DESC;
        `);

        for (const row of openInvoiceMismatchRes.rows as any[]) {
            issues.push({
                id: row.id,
                category: "open_invoice",
                type: "open_invoice_amount_mismatch",
                reference: row.invoice,
                date: row.date,
                description: `Nilai tagihan piutang/hutang faktur #${row.invoice} (Rp ${Number(row.oi_amount).toLocaleString()}) tidak sama dengan total transaksi (Rp ${Number(row.trx_total).toLocaleString()})`,
                expectedValue: Number(row.trx_total),
                actualValue: Number(row.oi_amount),
                difference: Math.abs(Number(row.oi_amount) - Number(row.trx_total)),
                canAutoFix: true,
                fixAction: "sync_open_invoice_amount",
                details: { openInvoiceId: row.id, correctAmount: Number(row.trx_total) },
            });
        }

        // b. Open Invoices Orphan
        const orphanOpenInvoicesRes = await db.execute(sql`
            SELECT oi.id, oi.transaction_id, oi.type, oi.amount::numeric as amount
            FROM open_invoices oi
            LEFT JOIN transactions t ON t.id = oi.transaction_id
            WHERE oi.transaction_id IS NOT NULL AND t.id IS NULL;
        `);

        for (const row of orphanOpenInvoicesRes.rows as any[]) {
            issues.push({
                id: row.id,
                category: "open_invoice",
                type: "orphan_open_invoice",
                reference: `Open Invoice #${row.id.slice(0, 8)}`,
                description: `Faktur piutang/hutang terbuka terikat ke ID transaksi yang sudah dihapus`,
                canAutoFix: true,
                fixAction: "delete_orphan_open_invoice",
                details: { openInvoiceId: row.id },
            });
        }

        // -------------------------------------------------------------
        // RINGKASAN & HEALTH SCORE
        // -------------------------------------------------------------
        const summary = {
            journalBalance: {
                count: issues.filter((i) => i.category === "journal_balance").length,
                status: issues.some((i) => i.category === "journal_balance") ? "danger" : "ok",
            },
            transactionJournals: {
                count: issues.filter((i) => i.category === "transaction_journal").length,
                status: issues.some((i) => i.category === "transaction_journal") ? "warning" : "ok",
            },
            stockIntegrity: {
                count: issues.filter((i) => i.category === "stock_integrity").length,
                status: issues.some((i) => i.category === "stock_integrity") ? "warning" : "ok",
            },
            orphanRecords: {
                count: issues.filter((i) => i.category === "orphan_record").length,
                status: issues.some((i) => i.category === "orphan_record") ? "danger" : "ok",
            },
            openInvoices: {
                count: issues.filter((i) => i.category === "open_invoice").length,
                status: issues.some((i) => i.category === "open_invoice") ? "warning" : "ok",
            },
        };

        const totalIssues = issues.length;
        const autoFixableCount = issues.filter((i) => i.canAutoFix).length;
        const healthScore = totalIssues === 0 ? 100 : Math.max(0, 100 - totalIssues * 5);

        return res.json({
            healthy: totalIssues === 0,
            healthScore,
            totalIssues,
            autoFixableCount,
            summary,
            issues,
        });
    } catch (err: any) {
        logger.error({ err }, "Error running getDataIntegrityAudit");
        return res.status(500).json({
            message: "Gagal menjalankan audit integritas data",
            error: err.message,
        });
    }
}

export async function reconcileDataIntegrity(req: Request, res: Response) {
    const { action, targetId, fixType } = req.body;

    try {
        let fixedCount = 0;
        const reportLogs: string[] = [];

        await db.transaction(async (tx) => {
            // ---------------------------------------------------------
            // ACTION: POST DRAFT JOURNALS
            // ---------------------------------------------------------
            if (action === "fix-draft-journals" || action === "fix-all" || fixType === "post_draft_journal") {
                const condition = targetId
                    ? sql`j.id = ${targetId} AND j.status = 'draft'`
                    : sql`j.status = 'draft' AND t.status = 'posted'`;

                const updated = await tx.execute(sql`
                    UPDATE journals j
                    SET status = 'posted'
                    FROM transactions t
                    WHERE j.transaction_id = t.id AND ${condition}
                    RETURNING j.id, j.invoice;
                `);

                if (updated.rows.length > 0) {
                    fixedCount += updated.rows.length;
                    reportLogs.push(`Berhasil mengaktifkan (posted) ${updated.rows.length} jurnal transaksi draft.`);
                }
            }

            // ---------------------------------------------------------
            // ACTION: CANCEL JOURNALS FOR CANCELLED TRANSACTIONS
            // ---------------------------------------------------------
            if (action === "fix-all" || fixType === "cancel_journal") {
                const condition = targetId
                    ? sql`j.id = ${targetId} AND j.status != 'cancelled'`
                    : sql`t.status = 'cancelled' AND j.status != 'cancelled'`;

                const updated = await tx.execute(sql`
                    UPDATE journals j
                    SET status = 'cancelled'
                    FROM transactions t
                    WHERE j.transaction_id = t.id AND ${condition}
                    RETURNING j.id, j.invoice;
                `);

                if (updated.rows.length > 0) {
                    fixedCount += updated.rows.length;
                    reportLogs.push(`Membatalkan (cancelled) ${updated.rows.length} jurnal yang transaksinya telah dibatalkan.`);
                }
            }

            // ---------------------------------------------------------
            // ACTION: RECREATE MISSING STOCK MOVEMENTS
            // (Recreate movements FIRST so stock balances can be recalculated from full movements)
            // ---------------------------------------------------------
            if (action === "recreate-stock-movements" || action === "fix-all" || fixType === "recreate_stock_movements") {
                const targetTrxQuery = targetId
                    ? sql`SELECT t.* FROM transactions t WHERE t.id = ${targetId} AND t.status = 'posted'`
                    : sql`
                        SELECT t.* 
                        FROM transactions t
                        JOIN transaction_details td ON td.transaction_id = t.id
                        LEFT JOIN stock_movements sm ON sm.transaction_id = t.id
                        WHERE t.status = 'posted'
                          AND t.type IN ('sales', 'purchase', 'sales_return', 'purchase_return', 'adjustment', 'transfer_stock')
                        GROUP BY t.id
                        HAVING COUNT(DISTINCT sm.id) = 0 
                            OR COUNT(DISTINCT sm.id) < COUNT(DISTINCT td.id)
                            OR ABS(COALESCE(SUM(td.qty * td.base_ratio), 0) - COALESCE(SUM(ABS(sm.quantity)), 0)) > 0.01
                    `;

                const targetTrx = await tx.execute(targetTrxQuery);

                for (const trx of targetTrx.rows as any[]) {
                    try {
                        const trxItems = await tx
                            .select()
                            .from(transactionDetails)
                            .where(eq(transactionDetails.transactionId, trx.id));

                        if (trxItems.length > 0) {
                            await tx.delete(stockMovements).where(eq(stockMovements.transactionId, trx.id));

                            await updateStockForTransaction(
                                trx.id,
                                trx.type,
                                trxItems.map((d: any) => ({
                                    productId: d.productId,
                                    warehouseId: d.warehouseId,
                                    qty: Number(d.qty),
                                    baseRatio: Number(d.baseRatio || 1),
                                    movementType: Number(d.movementType),
                                    unitCost: Number(d.unitCost || 0),
                                    batchNumber: d.batchNumber,
                                    expiryDate: d.expiryDate,
                                    serialNumbers: d.serialNumbers,
                                })),
                                tx,
                            );

                            // Recalculate and calibrate stocks.qty directly from movements so it never doubles
                            const productIds = Array.from(new Set(trxItems.map((d: any) => d.productId)));
                            if (productIds.length > 0) {
                                await tx.execute(sql`
                                    WITH calculated AS (
                                        SELECT 
                                            s.id as stock_id,
                                            COALESCE(SUM(
                                                CASE 
                                                    WHEN sm.type = 'IN' THEN ABS(sm.quantity)
                                                    WHEN sm.type = 'OUT' THEN -ABS(sm.quantity)
                                                    ELSE sm.quantity
                                                END
                                            ), 0) as calc_qty
                                        FROM stocks s
                                        LEFT JOIN stock_movements sm ON sm.stock_id = s.id
                                        WHERE s.product_id IN ${productIds}
                                        GROUP BY s.id
                                    )
                                    UPDATE stocks
                                    SET qty = calculated.calc_qty
                                    FROM calculated
                                    WHERE stocks.id = calculated.stock_id
                                      AND ABS(stocks.qty - calculated.calc_qty) > 0.001;
                                `);
                            }

                            fixedCount++;
                            reportLogs.push(`Berhasil memulihkan mutasi stok untuk transaksi #${trx.invoice}.`);
                        }
                    } catch (smErr: any) {
                        logger.warn({ err: smErr }, `Failed to recreate movements for ${trx.invoice}`);
                    }
                }
            }

            // ---------------------------------------------------------
            // ACTION: RECALCULATE STOCK BALANCES
            // ---------------------------------------------------------
            if (action === "recalculate-stocks" || action === "fix-all" || fixType === "recalculate_stock") {
                // If fixing a specific stock, ensure any posted transactions missing movements for this product are restored first!
                if (targetId && fixType === "recalculate_stock") {
                    const missingForProduct = await tx.execute(sql`
                        SELECT DISTINCT t.id, t.type, t.invoice
                        FROM transactions t
                        JOIN transaction_details td ON td.transaction_id = t.id
                        JOIN stocks s ON s.product_id = td.product_id
                        LEFT JOIN stock_movements sm ON sm.transaction_id = t.id
                        WHERE s.id = ${targetId}
                          AND t.status = 'posted'
                          AND t.type IN ('sales', 'purchase', 'sales_return', 'purchase_return', 'adjustment', 'transfer_stock')
                        GROUP BY t.id, t.type, t.invoice
                        HAVING COUNT(DISTINCT sm.id) = 0 OR COUNT(DISTINCT sm.id) < COUNT(DISTINCT td.id);
                    `);

                    for (const mTrx of missingForProduct.rows as any[]) {
                        const trxItems = await tx
                            .select()
                            .from(transactionDetails)
                            .where(eq(transactionDetails.transactionId, mTrx.id));

                        if (trxItems.length > 0) {
                            await tx.delete(stockMovements).where(eq(stockMovements.transactionId, mTrx.id));
                            await updateStockForTransaction(
                                mTrx.id,
                                mTrx.type,
                                trxItems.map((d: any) => ({
                                    productId: d.productId,
                                    warehouseId: d.warehouseId,
                                    qty: Number(d.qty),
                                    baseRatio: Number(d.baseRatio || 1),
                                    movementType: Number(d.movementType),
                                    unitCost: Number(d.unitCost || 0),
                                    batchNumber: d.batchNumber,
                                    expiryDate: d.expiryDate,
                                    serialNumbers: d.serialNumbers,
                                })),
                                tx,
                            );
                            fixedCount++;
                            reportLogs.push(`Memulihkan mutasi transaksi #${mTrx.invoice} sebelum menghitung ulang stok.`);
                        }
                    }
                }

                const whereClause = targetId
                    ? sql`WHERE s.id = ${targetId}`
                    : sql``;

                const syncedStocks = await tx.execute(sql`
                    WITH calculated AS (
                        SELECT 
                            s.id as stock_id,
                            COALESCE(SUM(
                                CASE 
                                    WHEN sm.type = 'IN' THEN ABS(sm.quantity)
                                    WHEN sm.type = 'OUT' THEN -ABS(sm.quantity)
                                    ELSE sm.quantity
                                END
                            ), 0) as calc_qty
                        FROM stocks s
                        LEFT JOIN stock_movements sm ON sm.stock_id = s.id
                        ${whereClause}
                        GROUP BY s.id
                    )
                    UPDATE stocks
                    SET qty = calculated.calc_qty
                    FROM calculated
                    WHERE stocks.id = calculated.stock_id
                      AND ABS(stocks.qty - calculated.calc_qty) > 0.001
                    RETURNING stocks.id, stocks.qty;
                `);

                if (syncedStocks.rows.length > 0) {
                    fixedCount += syncedStocks.rows.length;
                    reportLogs.push(`Berhasil menyelaraskan saldo master ${syncedStocks.rows.length} stok dengan mutasi riil.`);
                }
            }

            // ---------------------------------------------------------
            // ACTION: CLEAN ORPHAN RECORDS
            // ---------------------------------------------------------
            if (action === "clean-orphans" || action === "fix-all" || fixType === "delete_orphan_journal") {
                // Delete orphan journal entries first
                const deletedEntries = await tx.execute(sql`
                    DELETE FROM journal_entries
                    WHERE journal_id NOT IN (SELECT id FROM journals)
                       OR (account_id IS NOT NULL AND account_id NOT IN (SELECT id FROM gl_accounts))
                    RETURNING id;
                `);

                // Delete orphan journals without transactions
                const deletedJournals = await tx.execute(sql`
                    DELETE FROM journals
                    WHERE transaction_id IS NOT NULL 
                      AND transaction_id NOT IN (SELECT id FROM transactions)
                    RETURNING id;
                `);

                // Delete orphan stock movements
                const deletedMovements = await tx.execute(sql`
                    DELETE FROM stock_movements
                    WHERE transaction_id IS NOT NULL 
                      AND transaction_id NOT IN (SELECT id FROM transactions)
                    RETURNING id;
                `);

                // Delete orphan open invoices
                const deletedInvoices = await tx.execute(sql`
                    DELETE FROM open_invoices
                    WHERE transaction_id IS NOT NULL 
                      AND transaction_id NOT IN (SELECT id FROM transactions)
                    RETURNING id;
                `);

                const totalOrphans =
                    deletedEntries.rows.length +
                    deletedJournals.rows.length +
                    deletedMovements.rows.length +
                    deletedInvoices.rows.length;

                if (totalOrphans > 0) {
                    fixedCount += totalOrphans;
                    reportLogs.push(`Membersihkan ${totalOrphans} record orphan (jurnal, entri, mutasi, open invoice yatim).`);
                }
            }

            // ---------------------------------------------------------
            // ACTION: SYNC OPEN INVOICE AMOUNTS
            // ---------------------------------------------------------
            if (action === "sync-open-invoices" || action === "fix-all" || fixType === "sync_open_invoice_amount") {
                const condition = targetId
                    ? sql`oi.id = ${targetId}`
                    : sql`ABS(oi.amount - t.total_amount) > 0.01`;

                const updated = await tx.execute(sql`
                    UPDATE open_invoices oi
                    SET amount = t.total_amount
                    FROM transactions t
                    WHERE oi.transaction_id = t.id AND ${condition}
                    RETURNING oi.id;
                `);

                if (updated.rows.length > 0) {
                    fixedCount += updated.rows.length;
                    reportLogs.push(`Menyelaraskan nominal ${updated.rows.length} open invoice dengan nominal transaksi.`);
                }
            }

            // ---------------------------------------------------------
            // ACTION: REGENERATE MISSING JOURNALS FOR POSTED TRANSACTIONS
            // ---------------------------------------------------------
            if (action === "regenerate-missing-journals" || action === "fix-all" || fixType === "regenerate_journal") {
                const targetTrxQuery = targetId
                    ? sql`SELECT t.* FROM transactions t WHERE t.id = ${targetId} AND t.status = 'posted'`
                    : sql`
                        SELECT t.* 
                        FROM transactions t
                        LEFT JOIN journals j ON j.transaction_id = t.id
                        WHERE t.status = 'posted'
                          AND t.type IN ('sales', 'purchase', 'sales_return', 'purchase_return')
                          AND j.id IS NULL
                    `;

                const targetTrx = await tx.execute(targetTrxQuery);

                for (const trx of targetTrx.rows as any[]) {
                    try {
                        const journalBranchId = await resolveBranchId(trx.branch_id, req);
                        const journalBranchCode = await resolveBranchCodeFromId(journalBranchId);
                        const journalInvoice = await generateJournalInvoice(trx.type, journalBranchCode, tx);

                        const [newJournal] = await tx
                            .insert(journals)
                            .values({
                                invoice: journalInvoice,
                                transactionId: trx.id,
                                branchId: journalBranchId,
                                date: trx.date,
                                description: `Rekonsiliasi Jurnal ${trx.type.toUpperCase()} #${trx.invoice}`,
                                status: "posted",
                            })
                            .returning();

                        // Fetch account mappings
                        const mappingType = trx.type as any;
                        const taxMappingType = `${trx.type}_tax` as any;
                        const mappings = await tx
                            .select()
                            .from(accountMappings)
                            .where(or(eq(accountMappings.type, mappingType), eq(accountMappings.type, taxMappingType)));

                        const totalAmount = Number(trx.total_amount || 0);
                        const totalTax = Number(trx.total_tax || 0);

                        for (const map of mappings) {
                            let amount = 0;
                            if (map.type === mappingType) {
                                if (trx.type === "sales") {
                                    amount = map.side === "debit" ? totalAmount : totalAmount - totalTax;
                                } else if (trx.type === "purchase") {
                                    amount = map.side === "credit" ? totalAmount : totalAmount - totalTax;
                                } else {
                                    amount = totalAmount;
                                }
                            } else if (map.type === taxMappingType) {
                                amount = totalTax;
                            }

                            if (amount <= 0) continue;

                            const glAcc = await tx.query.glAccounts.findFirst({
                                where: eq(glAccounts.code, map.glAccountCode),
                            });

                            if (glAcc) {
                                await tx.insert(journalEntries).values({
                                    journalId: newJournal.id,
                                    glAccountId: glAcc.id,
                                    debit: map.side === "debit" ? amount : 0,
                                    credit: map.side === "credit" ? amount : 0,
                                    note: `${map.note} ${trx.invoice}`,
                                });
                            }
                        }

                        // Ensure open invoice exists
                        const [existingOI] = await tx
                            .select()
                            .from(openInvoices)
                            .where(eq(openInvoices.transactionId, trx.id))
                            .limit(1);

                        if (!existingOI) {
                            const isPayable = trx.type === "purchase" || trx.type === "sales_return";
                            await tx.insert(openInvoices).values({
                                transactionId: trx.id,
                                contactId: trx.contact_id,
                                branchId: journalBranchId,
                                type: isPayable ? "payable" : "receivable",
                                dueDate: addDays(trx.date, Number(trx.term_of_payment || 0)),
                                amount: totalAmount,
                                paidAmount: 0,
                                status: "open",
                            });
                        }

                        fixedCount++;
                        reportLogs.push(`Berhasil menerbitkan ulang jurnal #${journalInvoice} untuk transaksi #${trx.invoice}.`);
                    } catch (genErr: any) {
                        logger.warn({ err: genErr }, `Failed to regenerate journal for ${trx.invoice}`);
                    }
                }
            }
        });

        return res.json({
            success: true,
            fixedCount,
            details: reportLogs,
            message:
                fixedCount > 0
                    ? `Rekonsiliasi data selesai. Berhasil memperbaiki ${fixedCount} item data.`
                    : "Tidak ada data yang memerlukan perbaikan otomatis.",
        });
    } catch (err: any) {
        logger.error({ err }, "Error in reconcileDataIntegrity");
        return res.status(500).json({
            message: "Gagal melakukan rekonsiliasi data",
            error: err.message,
        });
    }
}
