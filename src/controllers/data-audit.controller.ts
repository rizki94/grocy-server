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
    paymentLines,
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
import {
    getCogsGlAccountId,
    getInventoryGlAccountId,
    getAccountsPayableGlAccountId,
    getAccountsReceivableGlAccountId,
    getSalesRevenueGlAccountId,
    getInputTaxGlAccountId,
    getOutputTaxGlAccountId,
    getSalesReturnGlAccountId,
} from "@/repositories/gl-account.repository";

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

        // =============================================================
        // 1. KESEIMBANGAN JURNAL (Debit vs Kredit)
        // =============================================================
        // Hanya periksa jurnal aktif (tidak dibatalkan)
        const unbalancedJournalsRes = await db.execute(sql`
            SELECT 
                j.id, 
                j.invoice, 
                j.date, 
                j.status,
                j.transaction_id,
                COUNT(je.id) as entry_count,
                COALESCE(SUM(je.debit), 0)::numeric as total_debit,
                COALESCE(SUM(je.credit), 0)::numeric as total_credit,
                ABS(COALESCE(SUM(je.debit), 0) - COALESCE(SUM(je.credit), 0))::numeric as diff
            FROM journals j
            LEFT JOIN journal_entries je ON je.journal_id = j.id
            WHERE j.status != 'cancelled'
            GROUP BY j.id, j.invoice, j.date, j.status, j.transaction_id
            HAVING ABS(COALESCE(SUM(je.debit), 0) - COALESCE(SUM(je.credit), 0)) > 0.01
                OR COUNT(je.id) = 0
            ORDER BY j.date DESC;
        `);

        for (const row of unbalancedJournalsRes.rows as any[]) {
            const isZeroEntries = Number(row.entry_count) === 0;
            const hasLinkedTrx = Boolean(row.transaction_id);

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
                canAutoFix: hasLinkedTrx,
                fixAction: hasLinkedTrx ? "regenerate_journal" : undefined,
                details: row,
            });
        }

        // =============================================================
        // 2. INTEGRITAS TRANSAKSI VS JURNAL
        // =============================================================
        // a. Transaksi Aktif (posted/partial/paid) Tanpa Jurnal Aktif
        const postedWithoutJournalsRes = await db.execute(sql`
            SELECT t.id, t.type, t.invoice, t.date, t.total_amount, t.status, b.name as branch_name
            FROM transactions t
            LEFT JOIN journals j ON j.transaction_id = t.id AND j.status != 'cancelled'
            LEFT JOIN branches b ON b.id = t.branch_id
            WHERE t.status IN ('posted', 'partial', 'paid')
              AND t.type IN ('sales', 'purchase', 'sales_return', 'purchase_return', 'adjustment', 'pos_sales')
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
                description: `Transaksi ${row.type.toUpperCase()} #${row.invoice} berstatus ${row.status.toUpperCase()} tetapi belum memiliki jurnal akuntansi aktif`,
                expectedValue: "active journal",
                actualValue: "missing",
                difference: Number(row.total_amount || 0),
                canAutoFix: true,
                fixAction: "regenerate_journal",
                details: { transactionId: row.id, type: row.type },
            });
        }

        // b. Draft Journal pada Transaksi Aktif
        const draftJournalsOnPostedTrxRes = await db.execute(sql`
            SELECT j.id, j.invoice as journal_invoice, t.id as trx_id, t.invoice as trx_invoice, t.type as trx_type, j.date, j.status as journal_status
            FROM journals j
            JOIN transactions t ON t.id = j.transaction_id
            WHERE t.status IN ('posted', 'partial', 'paid') AND j.status = 'draft'
            ORDER BY j.date DESC;
        `);

        for (const row of draftJournalsOnPostedTrxRes.rows as any[]) {
            issues.push({
                id: row.id,
                category: "transaction_journal",
                type: "draft_journal_on_posted_trx",
                reference: `${row.trx_invoice} (${row.journal_invoice})`,
                date: row.date,
                description: `Transaksi #${row.trx_invoice} berstatus aktif namun jurnal #${row.journal_invoice} masih berstatus draft`,
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

        // d. Selisih Nominal Transaksi dengan Total Jurnal
        // Pada akuntansi perpetual (sales/pos_sales/sales_return), jurnal mencatat nilai transaksi (piutang/hutang/pendapatan)
        // PLUS beban pokok penjualan (HPP) & pengurangan persediaan.
        // Oleh karena itu, kita membandingkan nilai transaksi dengan effective debit/credit (tanpa baris HPP/persediaan)
        const journalAmountMismatchRes = await db.execute(sql`
            SELECT 
                t.id, t.type, t.invoice, t.date, t.total_amount::numeric as trx_total,
                j.id as journal_id, j.invoice as journal_invoice,
                COALESCE(SUM(
                    CASE 
                        WHEN t.type IN ('sales', 'pos_sales') AND (gl.code LIKE '5%' OR gl.type = 'expense' OR je.note ILIKE '%pokok%' OR je.note ILIKE '%hpp%') THEN 0
                        WHEN t.type = 'sales_return' AND (gl.code LIKE '14%' OR je.note ILIKE '%persediaan%') THEN 0
                        ELSE je.debit
                    END
                ), 0)::numeric as effective_debit,
                COALESCE(SUM(
                    CASE 
                        WHEN t.type IN ('sales', 'pos_sales') AND (gl.code LIKE '14%' OR je.note ILIKE '%persediaan%') THEN 0
                        WHEN t.type = 'sales_return' AND (gl.code LIKE '5%' OR gl.type = 'expense' OR je.note ILIKE '%pokok%' OR je.note ILIKE '%hpp%') THEN 0
                        ELSE je.credit
                    END
                ), 0)::numeric as effective_credit,
                ABS(t.total_amount - COALESCE(SUM(
                    CASE 
                        WHEN t.type IN ('sales', 'pos_sales') AND (gl.code LIKE '5%' OR gl.type = 'expense' OR je.note ILIKE '%pokok%' OR je.note ILIKE '%hpp%') THEN 0
                        WHEN t.type = 'sales_return' AND (gl.code LIKE '14%' OR je.note ILIKE '%persediaan%') THEN 0
                        ELSE je.debit
                    END
                ), 0))::numeric as diff
            FROM transactions t
            JOIN journals j ON j.transaction_id = t.id AND j.status != 'cancelled'
            LEFT JOIN journal_entries je ON je.journal_id = j.id
            LEFT JOIN gl_accounts gl ON gl.id = je.account_id
            WHERE t.status IN ('posted', 'partial', 'paid')
              AND t.type IN ('sales', 'purchase', 'sales_return', 'purchase_return', 'pos_sales')
            GROUP BY t.id, t.type, t.invoice, t.date, t.total_amount, j.id, j.invoice
            HAVING ABS(t.total_amount - COALESCE(SUM(
                    CASE 
                        WHEN t.type IN ('sales', 'pos_sales') AND (gl.code LIKE '5%' OR gl.type = 'expense' OR je.note ILIKE '%pokok%' OR je.note ILIKE '%hpp%') THEN 0
                        WHEN t.type = 'sales_return' AND (gl.code LIKE '14%' OR je.note ILIKE '%persediaan%') THEN 0
                        ELSE je.debit
                    END
                ), 0)) > 0.05
               OR ABS(t.total_amount - COALESCE(SUM(
                    CASE 
                        WHEN t.type IN ('sales', 'pos_sales') AND (gl.code LIKE '14%' OR je.note ILIKE '%persediaan%') THEN 0
                        WHEN t.type = 'sales_return' AND (gl.code LIKE '5%' OR gl.type = 'expense' OR je.note ILIKE '%pokok%' OR je.note ILIKE '%hpp%') THEN 0
                        ELSE je.credit
                    END
                ), 0)) > 0.05
            ORDER BY t.date DESC;
        `);

        for (const row of journalAmountMismatchRes.rows as any[]) {
            issues.push({
                id: row.id,
                category: "transaction_journal",
                type: "journal_amount_mismatch",
                reference: `${row.invoice} (${row.journal_invoice})`,
                date: row.date,
                description: `Nominal transaksi #${row.invoice} (Rp ${Number(row.trx_total).toLocaleString()}) tidak sama dengan pengakuan nilai transaksi di jurnal (Rp ${Number(row.effective_debit).toLocaleString()})`,
                expectedValue: Number(row.trx_total),
                actualValue: Number(row.effective_debit),
                difference: Number(row.diff || 0),
                canAutoFix: true,
                fixAction: "regenerate_journal",
                details: { transactionId: row.id, journalId: row.journal_id },
            });
        }

        // =============================================================
        // 3. INTEGRITAS STOK VS MUTASI (stocks vs stock_movements)
        // =============================================================
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

        // b. Transaksi Aktif Tanpa Mutasi Stok (Menggunakan CTE agar bebas Cartesian Join & Rounding Presisi)
        const postedWithoutMovementsRes = await db.execute(sql`
            WITH td_agg AS (
                SELECT 
                    transaction_id,
                    COUNT(id) as item_count,
                    SUM(
                        CASE 
                            WHEN base_ratio = ROUND(base_ratio) AND ABS((qty * base_ratio) - ROUND(qty * base_ratio)) < 0.15
                            THEN ROUND(qty * base_ratio)
                            ELSE (qty * base_ratio)
                        END
                    ) as total_expected_qty
                FROM transaction_details
                GROUP BY transaction_id
            ),
            sm_agg AS (
                SELECT 
                    transaction_id,
                    COUNT(id) as movement_count,
                    SUM(ABS(quantity)) as total_actual_qty
                FROM stock_movements
                GROUP BY transaction_id
            )
            SELECT 
                t.id, 
                t.type, 
                t.invoice, 
                t.date,
                COALESCE(td_agg.item_count, 0) as expected_items,
                COALESCE(sm_agg.movement_count, 0) as actual_movements,
                COALESCE(td_agg.total_expected_qty, 0)::numeric as expected_qty,
                COALESCE(sm_agg.total_actual_qty, 0)::numeric as actual_qty
            FROM transactions t
            LEFT JOIN td_agg ON td_agg.transaction_id = t.id
            LEFT JOIN sm_agg ON sm_agg.transaction_id = t.id
            WHERE t.status IN ('posted', 'partial', 'paid')
              AND t.type IN ('sales', 'purchase', 'sales_return', 'purchase_return', 'adjustment', 'transfer_stock', 'pos_sales')
              AND (
                  COALESCE(sm_agg.movement_count, 0) = 0 
                  OR (t.type != 'transfer_stock' AND COALESCE(sm_agg.movement_count, 0) < COALESCE(td_agg.item_count, 0))
                  OR ABS(COALESCE(td_agg.total_expected_qty, 0) - COALESCE(sm_agg.total_actual_qty, 0)) > 0.15
              )
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
                desc = `Transaksi aktif #${row.invoice} (${row.type.toUpperCase()}) berisi ${expItems} barang tetapi tidak memiliki catatan mutasi stok`;
            } else if (actualMov < expItems) {
                desc = `Transaksi aktif #${row.invoice} (${row.type.toUpperCase()}) mutasi stok tidak lengkap (${actualMov} dari ${expItems} barang tercatat)`;
            } else {
                desc = `Transaksi aktif #${row.invoice} (${row.type.toUpperCase()}) kuantitas barang (${expQty}) tidak sesuai dengan mutasi stok (${actQty})`;
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

        // =============================================================
        // 4. DETEKSI RECORD ORPHAN (Yatim Tanpa Relasi)
        // =============================================================
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

        // b. Baris Jurnal Tanpa Parent Jurnal atau GL Account
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

        // d. Open Invoices Orphan
        const orphanOpenInvoicesRes = await db.execute(sql`
            SELECT oi.id, oi.transaction_id, oi.type, oi.amount::numeric as amount
            FROM open_invoices oi
            LEFT JOIN transactions t ON t.id = oi.transaction_id
            WHERE oi.transaction_id IS NOT NULL AND t.id IS NULL;
        `);

        for (const row of orphanOpenInvoicesRes.rows as any[]) {
            issues.push({
                id: row.id,
                category: "orphan_record",
                type: "orphan_open_invoice",
                reference: `Open Invoice #${row.id.slice(0, 8)}`,
                description: `Faktur piutang/hutang terbuka terikat ke ID transaksi yang sudah dihapus`,
                canAutoFix: true,
                fixAction: "delete_orphan_open_invoice",
                details: { openInvoiceId: row.id },
            });
        }

        // e. Transaction Details Orphan (Baris detail tanpa transaksi)
        const orphanDetailsRes = await db.execute(sql`
            SELECT td.id, td.transaction_id, td.product_id, td.qty
            FROM transaction_details td
            LEFT JOIN transactions t ON t.id = td.transaction_id
            WHERE td.transaction_id IS NOT NULL AND t.id IS NULL;
        `);

        for (const row of orphanDetailsRes.rows as any[]) {
            issues.push({
                id: row.id,
                category: "orphan_record",
                type: "orphan_transaction_detail",
                reference: `Detail #${row.id.slice(0, 8)}`,
                description: `Baris rincian barang transaksi terikat ke transaksi yang sudah tidak ada`,
                canAutoFix: true,
                fixAction: "delete_orphan_detail",
                details: { detailId: row.id },
            });
        }

        // =============================================================
        // 5. INTEGRITAS FAKTUR TERBUKA (Open Invoices AR / AP)
        // =============================================================
        // a. Selisih Nilai Open Invoice dengan Total Transaksi
        const openInvoiceMismatchRes = await db.execute(sql`
            SELECT oi.id, oi.transaction_id, oi.type, oi.amount::numeric as oi_amount, oi.paid_amount::numeric as oi_paid, t.invoice, t.total_amount::numeric as trx_total, t.date
            FROM open_invoices oi
            JOIN transactions t ON t.id = oi.transaction_id
            WHERE ABS(oi.amount - t.total_amount) > 0.01 
              AND oi.status != 'cancelled' 
              AND t.status != 'cancelled'
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

        // b. Transaksi Cancelled tapi Open Invoice Masih Aktif
        const cancelledTrxActiveOpenInvoicesRes = await db.execute(sql`
            SELECT oi.id, oi.transaction_id, oi.amount::numeric as amount, t.invoice, t.date, oi.status as oi_status
            FROM open_invoices oi
            JOIN transactions t ON t.id = oi.transaction_id
            WHERE t.status = 'cancelled' AND oi.status != 'cancelled'
            ORDER BY t.date DESC;
        `);

        for (const row of cancelledTrxActiveOpenInvoicesRes.rows as any[]) {
            issues.push({
                id: row.id,
                category: "open_invoice",
                type: "cancelled_trx_active_open_invoice",
                reference: row.invoice,
                date: row.date,
                description: `Transaksi #${row.invoice} telah dibatalkan namun faktur tagihannya masih aktif (${row.oi_status}) senilai Rp ${Number(row.amount).toLocaleString()}`,
                expectedValue: "cancelled",
                actualValue: row.oi_status,
                difference: Number(row.amount),
                canAutoFix: true,
                fixAction: "cancel_open_invoice",
                details: { openInvoiceId: row.id },
            });
        }

        // c. Transaksi Penjualan/Pembelian Aktif yang Belum Memiliki Open Invoice
        const missingOpenInvoicesRes = await db.execute(sql`
            SELECT t.id, t.type, t.invoice, t.date, t.total_amount::numeric as total_amount, t.status
            FROM transactions t
            LEFT JOIN open_invoices oi ON oi.transaction_id = t.id
            WHERE t.status IN ('posted', 'partial', 'paid')
              AND t.type IN ('sales', 'purchase', 'sales_return', 'purchase_return')
              AND t.total_amount > 0
              AND oi.id IS NULL
            ORDER BY t.date DESC;
        `);

        for (const row of missingOpenInvoicesRes.rows as any[]) {
            issues.push({
                id: row.id,
                category: "open_invoice",
                type: "missing_open_invoice",
                reference: row.invoice,
                date: row.date,
                description: `Transaksi #${row.invoice} (${row.type.toUpperCase()}) belum dibuatkan kartu tagihan piutang/hutang (Open Invoice)`,
                expectedValue: Number(row.total_amount),
                actualValue: "missing",
                difference: Number(row.total_amount),
                canAutoFix: true,
                fixAction: "create_missing_open_invoice",
                details: { transactionId: row.id, type: row.type },
            });
        }

        // d. Sinkronisasi Saldo Terbayar (paid_amount) Open Invoice vs Rincian Pembayaran
        const paymentMismatchRes = await db.execute(sql`
            SELECT 
                oi.id, oi.transaction_id, oi.type, oi.amount::numeric as amount, 
                oi.paid_amount::numeric as oi_paid,
                COALESCE(SUM(pl.amount), 0)::numeric as calculated_paid,
                t.invoice, t.date
            FROM open_invoices oi
            JOIN transactions t ON t.id = oi.transaction_id
            LEFT JOIN payment_lines pl ON pl.open_invoice_id = oi.id
            WHERE oi.status != 'cancelled'
            GROUP BY oi.id, oi.transaction_id, oi.type, oi.amount, oi.paid_amount, t.invoice, t.date
            HAVING ABS(oi.paid_amount - COALESCE(SUM(pl.amount), 0)) > 0.01
            ORDER BY t.date DESC;
        `);

        for (const row of paymentMismatchRes.rows as any[]) {
            issues.push({
                id: row.id,
                category: "open_invoice",
                type: "open_invoice_payment_mismatch",
                reference: row.invoice,
                date: row.date,
                description: `Catatan pembayaran faktur #${row.invoice} (Rp ${Number(row.oi_paid).toLocaleString()}) tidak sama dengan riwayat transaksi pembayaran (Rp ${Number(row.calculated_paid).toLocaleString()})`,
                expectedValue: Number(row.calculated_paid),
                actualValue: Number(row.oi_paid),
                difference: Math.abs(Number(row.oi_paid) - Number(row.calculated_paid)),
                canAutoFix: true,
                fixAction: "sync_open_invoice_payment",
                details: { openInvoiceId: row.id, correctPaid: Number(row.calculated_paid) },
            });
        }

        // =============================================================
        // RINGKASAN & HEALTH SCORE
        // =============================================================
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
        const healthScore = totalIssues === 0 ? 100 : Math.max(0, 100 - totalIssues * 4);

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

// Helper untuk mencari GL Account ID dengan aman
async function findGlAccountId(code: string, tx: any): Promise<string | null> {
    const res = await tx.execute(sql`SELECT id FROM gl_accounts WHERE code = ${code} LIMIT 1`);
    return res.rows[0]?.id || null;
}

export async function reconcileDataIntegrity(req: Request, res: Response) {
    const { action, targetId, fixType } = req.body;

    try {
        let fixedCount = 0;
        const reportLogs: string[] = [];

        await db.transaction(async (tx) => {
            // ---------------------------------------------------------
            // TAHAP 1: BERSIHKAN RECORD ORPHAN
            // ---------------------------------------------------------
            if (
                action === "clean-orphans" ||
                action === "fix-all" ||
                fixType === "delete_orphan_journal" ||
                fixType === "delete_orphan_entry" ||
                fixType === "delete_orphan_movement" ||
                fixType === "delete_orphan_open_invoice" ||
                fixType === "delete_orphan_detail"
            ) {
                // Hapus baris entri jurnal yatim
                const deletedEntries = await tx.execute(sql`
                    DELETE FROM journal_entries
                    WHERE journal_id NOT IN (SELECT id FROM journals)
                       OR (account_id IS NOT NULL AND account_id NOT IN (SELECT id FROM gl_accounts))
                    RETURNING id;
                `);

                // Hapus jurnal yatim tanpa transaksi
                const deletedJournals = await tx.execute(sql`
                    DELETE FROM journals
                    WHERE transaction_id IS NOT NULL 
                      AND transaction_id NOT IN (SELECT id FROM transactions)
                    RETURNING id;
                `);

                // Hapus mutasi stok yatim
                const deletedMovements = await tx.execute(sql`
                    DELETE FROM stock_movements
                    WHERE transaction_id IS NOT NULL 
                      AND transaction_id NOT IN (SELECT id FROM transactions)
                    RETURNING id;
                `);

                // Hapus open invoices yatim
                const deletedInvoices = await tx.execute(sql`
                    DELETE FROM open_invoices
                    WHERE transaction_id IS NOT NULL 
                      AND transaction_id NOT IN (SELECT id FROM transactions)
                    RETURNING id;
                `);

                // Hapus baris detail transaksi yatim
                const deletedDetails = await tx.execute(sql`
                    DELETE FROM transaction_details
                    WHERE transaction_id IS NOT NULL
                      AND transaction_id NOT IN (SELECT id FROM transactions)
                    RETURNING id;
                `);

                const totalOrphans =
                    deletedEntries.rows.length +
                    deletedJournals.rows.length +
                    deletedMovements.rows.length +
                    deletedInvoices.rows.length +
                    deletedDetails.rows.length;

                if (totalOrphans > 0) {
                    fixedCount += totalOrphans;
                    reportLogs.push(`Membersihkan ${totalOrphans} record orphan (jurnal, entri, mutasi, open invoice yatim).`);
                }
            }

            // ---------------------------------------------------------
            // TAHAP 2: SINKRONISASI STATUS JURNAL & FAKTUR
            // ---------------------------------------------------------
            // a. Aktifkan jurnal draft pada transaksi posted/paid/partial
            if (action === "fix-draft-journals" || action === "fix-all" || fixType === "post_draft_journal") {
                const condition = targetId
                    ? sql`j.id = ${targetId} AND j.status = 'draft'`
                    : sql`j.status = 'draft' AND t.status IN ('posted', 'partial', 'paid')`;

                const updated = await tx.execute(sql`
                    UPDATE journals j
                    SET status = 'posted'
                    FROM transactions t
                    WHERE j.transaction_id = t.id AND ${condition}
                    RETURNING j.id, j.invoice;
                `);

                if (updated.rows.length > 0) {
                    fixedCount += updated.rows.length;
                    reportLogs.push(`Berhasil mengaktifkan (posted) ${updated.rows.length} jurnal draft.`);
                }
            }

            // b. Batalkan jurnal pada transaksi cancelled
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

            // c. Batalkan open invoice pada transaksi cancelled
            if (action === "fix-all" || fixType === "cancel_open_invoice") {
                const condition = targetId
                    ? sql`oi.id = ${targetId} AND oi.status != 'cancelled'`
                    : sql`t.status = 'cancelled' AND oi.status != 'cancelled'`;

                const updated = await tx.execute(sql`
                    UPDATE open_invoices oi
                    SET status = 'cancelled'
                    FROM transactions t
                    WHERE oi.transaction_id = t.id AND ${condition}
                    RETURNING oi.id;
                `);

                if (updated.rows.length > 0) {
                    fixedCount += updated.rows.length;
                    reportLogs.push(`Membatalkan ${updated.rows.length} open invoice pada transaksi yang telah dibatalkan.`);
                }
            }

            // ---------------------------------------------------------
            // TAHAP 3: MEMULIHKAN MUTASI STOK TRANSAKSI (Bebas Stok Double)
            // ---------------------------------------------------------
            if (action === "recreate-stock-movements" || action === "fix-all" || fixType === "recreate_stock_movements") {
                const targetTrxQuery = targetId
                    ? sql`SELECT t.* FROM transactions t WHERE t.id = ${targetId} AND t.status IN ('posted', 'partial', 'paid')`
                    : sql`
                        WITH td_agg AS (
                            SELECT 
                                transaction_id,
                                COUNT(id) as item_count,
                                SUM(
                                    CASE 
                                        WHEN base_ratio = ROUND(base_ratio) AND ABS((qty * base_ratio) - ROUND(qty * base_ratio)) < 0.15
                                        THEN ROUND(qty * base_ratio)
                                        ELSE (qty * base_ratio)
                                    END
                                ) as total_expected_qty
                            FROM transaction_details
                            GROUP BY transaction_id
                        ),
                        sm_agg AS (
                            SELECT 
                                transaction_id,
                                COUNT(id) as movement_count,
                                SUM(ABS(quantity)) as total_actual_qty
                            FROM stock_movements
                            GROUP BY transaction_id
                        )
                        SELECT t.* 
                        FROM transactions t
                        LEFT JOIN td_agg ON td_agg.transaction_id = t.id
                        LEFT JOIN sm_agg ON sm_agg.transaction_id = t.id
                        WHERE t.status IN ('posted', 'partial', 'paid')
                          AND t.type IN ('sales', 'purchase', 'sales_return', 'purchase_return', 'adjustment', 'transfer_stock', 'pos_sales')
                          AND (
                              COALESCE(sm_agg.movement_count, 0) = 0 
                              OR (t.type != 'transfer_stock' AND COALESCE(sm_agg.movement_count, 0) < COALESCE(td_agg.item_count, 0))
                              OR ABS(COALESCE(td_agg.total_expected_qty, 0) - COALESCE(sm_agg.total_actual_qty, 0)) > 0.15
                          );
                    `;

                const targetTrx = await tx.execute(targetTrxQuery);

                for (const trx of targetTrx.rows as any[]) {
                    try {
                        const trxItems = await tx
                            .select()
                            .from(transactionDetails)
                            .where(eq(transactionDetails.transactionId, trx.id));

                        if (trxItems.length > 0) {
                            // Hapus mutasi lama yang tidak lengkap untuk transaksi ini
                            await tx.delete(stockMovements).where(eq(stockMovements.transactionId, trx.id));

                            // Normalisasi movementType agar 100% tepat untuk tipe transaksi apapun
                            const mappedDetails = trxItems.map((d: any) => {
                                let normMovementType = Number(d.movementType);
                                if (trx.type === "purchase" || trx.type === "sales_return") {
                                    normMovementType = 1;
                                } else if (trx.type === "sales" || trx.type === "pos_sales" || trx.type === "purchase_return") {
                                    normMovementType = -1;
                                } else if (trx.type === "adjustment") {
                                    normMovementType = Number(d.qty) >= 0 ? 1 : -1;
                                } else if (normMovementType === 2) {
                                    normMovementType = -1;
                                }

                                return {
                                    productId: d.productId,
                                    warehouseId: d.warehouseId,
                                    qty: Number(d.qty),
                                    baseRatio: Number(d.baseRatio || 1),
                                    movementType: normMovementType,
                                    unitCost: Number(d.unitCost || 0),
                                    batchNumber: d.batchNumber,
                                    expiryDate: d.expiryDate,
                                    serialNumbers: d.serialNumbers,
                                };
                            });

                            await updateStockForTransaction(trx.id, trx.type, mappedDetails, tx);

                            // Kalibrasi otomatis saldo snapshot stocks.qty dari mutasi riil (Mencegah Stok Double)
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
                            reportLogs.push(`Berhasil memulihkan mutasi stok transaksi #${trx.invoice} dan mengkalibrasi saldo stok.`);
                        }
                    } catch (smErr: any) {
                        logger.warn({ err: smErr }, `Failed to recreate movements for ${trx.invoice}`);
                    }
                }
            }

            // ---------------------------------------------------------
            // TAHAP 4: REKALKULASI SALDO STOK DARI LEDGER MUTASI
            // ---------------------------------------------------------
            if (action === "recalculate-stocks" || action === "fix-all" || fixType === "recalculate_stock") {
                const whereClause = targetId ? sql`WHERE s.id = ${targetId}` : sql``;

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
                    reportLogs.push(`Menyelaraskan saldo master ${syncedStocks.rows.length} stok dengan ledger mutasi riil.`);
                }
            }

            // ---------------------------------------------------------
            // TAHAP 5: TERBITKAN ULANG JURNAL AKUNTANSI LENGKAP & SEIMBANG
            // ---------------------------------------------------------
            if (action === "regenerate-missing-journals" || action === "fix-all" || fixType === "regenerate_journal") {
                const targetTrxQuery = targetId
                    ? sql`SELECT t.* FROM transactions t WHERE (t.id = ${targetId} OR t.id IN (SELECT transaction_id FROM journals WHERE id = ${targetId})) AND t.status IN ('posted', 'partial', 'paid')`
                    : sql`
                        SELECT t.* 
                        FROM transactions t
                        LEFT JOIN journals j ON j.transaction_id = t.id AND j.status != 'cancelled'
                        WHERE t.status IN ('posted', 'partial', 'paid')
                          AND t.type IN ('sales', 'purchase', 'sales_return', 'purchase_return', 'pos_sales')
                          AND j.id IS NULL
                    `;

                const targetTrx = await tx.execute(targetTrxQuery);

                for (const trx of targetTrx.rows as any[]) {
                    try {
                        const journalBranchId = await resolveBranchId(trx.branch_id, req);
                        const journalBranchCode = await resolveBranchCodeFromId(journalBranchId);
                        const journalPrefix = trx.type === "pos_sales" ? "pos" : trx.type;
                        const journalInvoice = await generateJournalInvoice(journalPrefix, journalBranchCode, tx);

                        // Hapus entri jurnal lama yang tidak seimbang atau corrupt jika ada
                        const existingJournals = await tx
                            .select()
                            .from(journals)
                            .where(eq(journals.transactionId, trx.id));

                        for (const ej of existingJournals) {
                            await tx.delete(journalEntries).where(eq(journalEntries.journalId, ej.id));
                            await tx.delete(journals).where(eq(journals.id, ej.id));
                        }

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

                        // Ambil konfigurasi pemetaan akun
                        let mappingLookupType = trx.type;
                        let taxLookupType = `${trx.type}_tax`;
                        if (trx.type === "pos_sales") {
                            mappingLookupType = "sales";
                            taxLookupType = "sales_tax";
                        }

                        let mappings = await tx
                            .select()
                            .from(accountMappings)
                            .where(or(eq(accountMappings.type, mappingLookupType as any), eq(accountMappings.type, taxLookupType as any)));

                        const totalAmount = Number(trx.total_amount || 0);
                        const totalTax = Number(trx.total_tax || 0);

                        // Jika konfigurasi mapping belum ada, gunakan Chart of Accounts standar via dynamic resolver
                        if (mappings.length === 0) {
                            if (trx.type === "purchase" || trx.type === "purchase_return") {
                                const invId = await getInventoryGlAccountId(tx);
                                const apId = await getAccountsPayableGlAccountId(tx);
                                const taxId = await getInputTaxGlAccountId(tx);

                                if (trx.type === "purchase") {
                                    if (invId && totalAmount - totalTax > 0) {
                                        await tx.insert(journalEntries).values({ journalId: newJournal.id, glAccountId: invId, debit: totalAmount - totalTax, credit: 0, note: `Persediaan ${trx.invoice}` });
                                    }
                                    if (taxId && totalTax > 0) {
                                        await tx.insert(journalEntries).values({ journalId: newJournal.id, glAccountId: taxId, debit: totalTax, credit: 0, note: `PPN Masukan ${trx.invoice}` });
                                    }
                                    if (apId && totalAmount > 0) {
                                        await tx.insert(journalEntries).values({ journalId: newJournal.id, glAccountId: apId, debit: 0, credit: totalAmount, note: `Hutang Usaha ${trx.invoice}` });
                                    }
                                } else {
                                    if (apId && totalAmount > 0) {
                                        await tx.insert(journalEntries).values({ journalId: newJournal.id, glAccountId: apId, debit: totalAmount, credit: 0, note: `Hutang Usaha (Retur) ${trx.invoice}` });
                                    }
                                    if (invId && totalAmount > 0) {
                                        await tx.insert(journalEntries).values({ journalId: newJournal.id, glAccountId: invId, debit: 0, credit: totalAmount, note: `Persediaan (Retur) ${trx.invoice}` });
                                    }
                                }
                            } else {
                                // sales / pos_sales / sales_return
                                const arId = await getAccountsReceivableGlAccountId(tx);
                                const revId = await getSalesRevenueGlAccountId(tx);
                                const taxId = await getOutputTaxGlAccountId(tx);

                                if (trx.type === "sales" || trx.type === "pos_sales") {
                                    if (arId && totalAmount > 0) {
                                        await tx.insert(journalEntries).values({ journalId: newJournal.id, glAccountId: arId, debit: totalAmount, credit: 0, note: `Piutang Usaha ${trx.invoice}` });
                                    }
                                    if (revId && totalAmount - totalTax > 0) {
                                        await tx.insert(journalEntries).values({ journalId: newJournal.id, glAccountId: revId, debit: 0, credit: totalAmount - totalTax, note: `Pendapatan Penjualan ${trx.invoice}` });
                                    }
                                    if (taxId && totalTax > 0) {
                                        await tx.insert(journalEntries).values({ journalId: newJournal.id, glAccountId: taxId, debit: 0, credit: totalTax, note: `PPN Keluaran ${trx.invoice}` });
                                    }
                                } else if (trx.type === "sales_return") {
                                    const retId = await getSalesReturnGlAccountId(tx);
                                    if (retId && totalAmount > 0) {
                                        await tx.insert(journalEntries).values({ journalId: newJournal.id, glAccountId: retId, debit: totalAmount, credit: 0, note: `Retur Penjualan ${trx.invoice}` });
                                    }
                                    if (arId && totalAmount > 0) {
                                        await tx.insert(journalEntries).values({ journalId: newJournal.id, glAccountId: arId, debit: 0, credit: totalAmount, note: `Piutang Usaha (Retur) ${trx.invoice}` });
                                    }
                                }
                            }
                        } else {
                            // Tulis baris jurnal sesuai pemetaan akun
                            for (const map of mappings) {
                                let amount = 0;
                                if (map.type === mappingLookupType) {
                                    if (trx.type === "sales" || trx.type === "pos_sales") {
                                        amount = map.side === "debit" ? totalAmount : totalAmount - totalTax;
                                    } else if (trx.type === "purchase") {
                                        amount = map.side === "credit" ? totalAmount : totalAmount - totalTax;
                                    } else {
                                        amount = totalAmount;
                                    }
                                } else if (map.type === taxLookupType) {
                                    amount = totalTax;
                                }

                                if (amount <= 0) continue;

                                const glAccId = await findGlAccountId(map.glAccountCode, tx);
                                if (glAccId) {
                                    await tx.insert(journalEntries).values({
                                        journalId: newJournal.id,
                                        glAccountId: glAccId,
                                        debit: map.side === "debit" ? amount : 0,
                                        credit: map.side === "credit" ? amount : 0,
                                        note: `${map.note} ${trx.invoice}`,
                                    });
                                }
                            }
                        }

                        // Catat HPP & Persediaan untuk sistem perpetual (sales, pos_sales, sales_return)
                        if (["sales", "pos_sales", "sales_return"].includes(trx.type)) {
                            const detailsWithCost = await tx
                                .select()
                                .from(transactionDetails)
                                .where(eq(transactionDetails.transactionId, trx.id));

                            const totalCogs = detailsWithCost.reduce(
                                (sum: number, d: any) =>
                                    sum + Number(d.totalCost || (Number(d.qty || 0) * Number(d.unitCost || 0))),
                                0,
                            );

                            if (totalCogs > 0) {
                                const cogsGlId = await getCogsGlAccountId(tx);
                                const invGlId = await getInventoryGlAccountId(tx);

                                if (trx.type === "sales" || trx.type === "pos_sales") {
                                    if (cogsGlId) {
                                        await tx.insert(journalEntries).values({
                                            journalId: newJournal.id,
                                            glAccountId: cogsGlId,
                                            debit: totalCogs,
                                            credit: 0,
                                            note: `Beban Pokok Penjualan ${trx.invoice}`,
                                        });
                                    }
                                    if (invGlId) {
                                        await tx.insert(journalEntries).values({
                                            journalId: newJournal.id,
                                            glAccountId: invGlId,
                                            debit: 0,
                                            credit: totalCogs,
                                            note: `Pengurangan Persediaan ${trx.invoice}`,
                                        });
                                    }
                                } else if (trx.type === "sales_return") {
                                    if (invGlId) {
                                        await tx.insert(journalEntries).values({
                                            journalId: newJournal.id,
                                            glAccountId: invGlId,
                                            debit: totalCogs,
                                            credit: 0,
                                            note: `Persediaan Retur Penjualan ${trx.invoice}`,
                                        });
                                    }
                                    if (cogsGlId) {
                                        await tx.insert(journalEntries).values({
                                            journalId: newJournal.id,
                                            glAccountId: cogsGlId,
                                            debit: 0,
                                            credit: totalCogs,
                                            note: `Pengurangan HPP Retur Penjualan ${trx.invoice}`,
                                        });
                                    }
                                }
                            }
                        }

                        // Pastikan open invoice AR/AP juga dibuat jika berlaku
                        if (["sales", "purchase", "sales_return", "purchase_return"].includes(trx.type)) {
                            const [existingOI] = await tx
                                .select()
                                .from(openInvoices)
                                .where(eq(openInvoices.transactionId, trx.id))
                                .limit(1);

                            if (!existingOI && totalAmount > 0) {
                                const isPayable = trx.type === "purchase" || trx.type === "sales_return";
                                const isFullyPaid = trx.status === "paid";
                                await tx.insert(openInvoices).values({
                                    transactionId: trx.id,
                                    contactId: trx.contact_id,
                                    branchId: journalBranchId,
                                    type: isPayable ? "payable" : "receivable",
                                    dueDate: addDays(trx.date, Number(trx.term_of_payment || 0)),
                                    amount: totalAmount,
                                    paidAmount: isFullyPaid ? totalAmount : 0,
                                    status: isFullyPaid ? "paid" : "open",
                                });
                            }
                        }

                        fixedCount++;
                        reportLogs.push(`Berhasil menerbitkan ulang jurnal #${journalInvoice} untuk transaksi #${trx.invoice}.`);
                    } catch (genErr: any) {
                        logger.warn({ err: genErr }, `Failed to regenerate journal for ${trx.invoice}`);
                    }
                }
            }

            // ---------------------------------------------------------
            // TAHAP 6: SINKRONISASI OPEN INVOICES (AR/AP)
            // ---------------------------------------------------------
            // a. Sinkronisasi nominal tagihan dengan transaksi
            if (action === "sync-open-invoices" || action === "fix-all" || fixType === "sync_open_invoice_amount") {
                const condition = targetId
                    ? sql`oi.id = ${targetId}`
                    : sql`ABS(oi.amount - t.total_amount) > 0.01 AND oi.status != 'cancelled' AND t.status != 'cancelled'`;

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

            // b. Buat open invoice yang hilang
            if (action === "fix-all" || fixType === "create_missing_open_invoice") {
                const condition = targetId ? sql`t.id = ${targetId}` : sql`oi.id IS NULL`;

                const missingOIs = await tx.execute(sql`
                    SELECT t.id, t.type, t.invoice, t.date, t.total_amount::numeric as total_amount, t.status, t.contact_id, t.branch_id, t.term_of_payment
                    FROM transactions t
                    LEFT JOIN open_invoices oi ON oi.transaction_id = t.id
                    WHERE t.status IN ('posted', 'partial', 'paid')
                      AND t.type IN ('sales', 'purchase', 'sales_return', 'purchase_return')
                      AND t.total_amount > 0
                      AND ${condition};
                `);

                for (const row of missingOIs.rows as any[]) {
                    try {
                        const journalBranchId = await resolveBranchId(row.branch_id, req);
                        const isPayable = row.type === "purchase" || row.type === "sales_return";
                        const isFullyPaid = row.status === "paid";
                        const totAmount = Number(row.total_amount || 0);

                        await tx.insert(openInvoices).values({
                            transactionId: row.id,
                            contactId: row.contact_id,
                            branchId: journalBranchId,
                            type: isPayable ? "payable" : "receivable",
                            dueDate: addDays(row.date, Number(row.term_of_payment || 0)),
                            amount: totAmount,
                            paidAmount: isFullyPaid ? totAmount : 0,
                            status: isFullyPaid ? "paid" : "open",
                        });

                        fixedCount++;
                        reportLogs.push(`Membuat open invoice baru untuk transaksi #${row.invoice}.`);
                    } catch (oiErr: any) {
                        logger.warn({ err: oiErr }, `Failed to create open invoice for ${row.invoice}`);
                    }
                }
            }

            // c. Sinkronisasi paid_amount open invoice dari riwayat pembayaran
            if (action === "fix-all" || fixType === "sync_open_invoice_payment") {
                const condition = targetId ? sql`oi.id = ${targetId}` : sql`1=1`;

                const syncedPayments = await tx.execute(sql`
                    WITH calculated AS (
                        SELECT 
                            oi.id as oi_id,
                            oi.amount as oi_amount,
                            COALESCE(SUM(pl.amount), 0) as calc_paid
                        FROM open_invoices oi
                        LEFT JOIN payment_lines pl ON pl.open_invoice_id = oi.id
                        WHERE ${condition} AND oi.status != 'cancelled'
                        GROUP BY oi.id, oi.amount
                    )
                    UPDATE open_invoices
                    SET 
                        paid_amount = calculated.calc_paid,
                        status = CASE 
                            WHEN calculated.calc_paid >= calculated.oi_amount THEN 'paid'
                            WHEN calculated.calc_paid > 0 THEN 'partial'
                            ELSE 'open'
                        END
                    FROM calculated
                    WHERE open_invoices.id = calculated.oi_id
                      AND ABS(open_invoices.paid_amount - calculated.calc_paid) > 0.01
                    RETURNING open_invoices.id;
                `);

                if (syncedPayments.rows.length > 0) {
                    fixedCount += syncedPayments.rows.length;
                    reportLogs.push(`Menyelaraskan ${syncedPayments.rows.length} catatan pembayaran faktur terbuka.`);
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
