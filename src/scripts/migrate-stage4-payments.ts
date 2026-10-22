/**
 * migrate-stage4-payments.ts
 *
 * Migrates Pelunasan Piutang (BD-BCA) and Pelunasan Hutang (BD-BCP) from
 * SQL Server H_Notes / D_Notes2 / D_Notes1 into PostgreSQL:
 *   - payments
 *   - payment_lines  (linked to open_invoices via transaction invoice number)
 *   - payment_accounts (bank/cash GL account used)
 *   - journals + journal_entries (posted GL entries)
 *   - updates open_invoices.paidAmount & status
 *   - updates transactions.status
 *
 * Run with: npx ts-node --project tsconfig.json src/scripts/migrate-stage4-payments.ts
 */

import sql from "mssql";
import { db } from "../db";
import { eq } from "drizzle-orm";
import {
    branches,
    contacts,
    glAccounts,
    journals,
    journalEntries,
    openInvoices,
    payments,
    paymentLines,
    paymentAccounts,
    transactions,
    users,
} from "../db/schemas";

const mssqlConfig: sql.config = {
    user: "api",
    password: "Hrd12345",
    server: "192.168.5.100",
    port: 1433,
    database: "dbPrimaNusantara",
    options: {
        encrypt: false,
        trustServerCertificate: true,
        requestTimeout: 120000,
    },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function determinePaidStatus(
    paidAmount: number,
    totalAmount: number,
): "open" | "partial" | "paid" | "overpaid" {
    const paidCents = Math.round(paidAmount * 100);
    const totalCents = Math.round(totalAmount * 100);

    if (totalCents < 0) {
        if (paidCents < totalCents) return "overpaid";
        if (paidCents <= totalCents) return "paid";
        if (paidCents < 0) return "partial";
        return "open";
    } else {
        if (paidCents > totalCents) return "overpaid";
        if (paidCents >= totalCents) return "paid";
        if (paidCents > 0) return "partial";
        return "open";
    }
}

function determineTxStatus(
    invoiceStatus: "open" | "partial" | "paid" | "overpaid",
): "posted" | "partial" | "paid" {
    if (invoiceStatus === "paid" || invoiceStatus === "overpaid") return "paid";
    if (invoiceStatus === "partial") return "partial";
    return "posted";
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    console.log("=".repeat(60));
    console.log("Stage 4: Migrate Payments (Pelunasan Piutang & Hutang)");
    console.log("Source : SQL Server dbPrimaNusantara (192.168.5.100)");
    console.log("Target : Grocy PostgreSQL Database");
    console.log("=".repeat(60) + "\n");

    const pool = await sql.connect(mssqlConfig);
    console.log("Connected to SQL Server\n");

    // ── Load lookup maps ──────────────────────────────────────────────────────

    console.log("Loading lookup maps from PostgreSQL...");
    const allBranches = await db.select().from(branches);
    const branchMap: Record<string, typeof branches.$inferSelect> = {};
    for (const b of allBranches) branchMap[b.code] = b;
    const defaultBranch = allBranches.find((b) => b.isHq) || allBranches[0];

    // Contact map: SQL Server Contact (int) -> PG contacts row
    const contactsSrc = await pool
        .request()
        .query("SELECT Contact, CompanyName FROM MstContact");
    const allContacts = await db.select().from(contacts);
    const contactMap: Record<number, typeof contacts.$inferSelect> = {};
    for (const c of contactsSrc.recordset) {
        const name = (c.CompanyName || "Contact " + c.Contact).trim();
        const found = allContacts.find(
            (ct) => ct.name.toLowerCase() === name.toLowerCase(),
        );
        if (found) contactMap[c.Contact] = found;
    }

    // GL Account map: code -> PG glAccounts row
    const allGl = await db.select().from(glAccounts);
    const glMapByCode: Record<string, typeof glAccounts.$inferSelect> = {};
    for (const g of allGl) glMapByCode[g.code] = g;

    // Open Invoices map: transaction invoice -> open_invoices row
    const allOpenInvoices = await db
        .select({
            id: openInvoices.id,
            transactionId: openInvoices.transactionId,
            type: openInvoices.type,
            amount: openInvoices.amount,
            paidAmount: openInvoices.paidAmount,
            status: openInvoices.status,
            invoice: transactions.invoice,
        })
        .from(openInvoices)
        .leftJoin(transactions, eq(openInvoices.transactionId, transactions.id));

    const openInvoiceByInvoice: Record<string, typeof allOpenInvoices[0]> = {};
    for (const oi of allOpenInvoices) {
        if (oi.invoice) openInvoiceByInvoice[oi.invoice.trim()] = oi;
    }

    // Already-migrated vouchers: check BOTH payments.reference AND journals.invoice
    const existingPayments = await db
        .select({ reference: payments.reference })
        .from(payments);
    const existingPaymentRefs = new Set(
        existingPayments.map((p) => p.reference).filter(Boolean),
    );

    const existingJournals = await db
        .select({ invoice: journals.invoice })
        .from(journals);
    const existingJournalInvoices = new Set(
        existingJournals.map((j) => j.invoice).filter(Boolean),
    );

    console.log(
        "  Branches: " + allBranches.length +
        ", Contacts: " + allContacts.length +
        ", GL accounts: " + allGl.length +
        ", Open invoices: " + allOpenInvoices.length + "\n",
    );

    // ── Fetch SQL Server data ────────────────────────────────────────────────

    // All BD-BCA and BD-BCP voucher headers
    const hNotesSrc = await pool.request().query(`
        SELECT IdNotes, DateNotes, CodeTr, Contact, Descr, GrpCode, Invoice, Payment, BranchId
        FROM H_Notes
        WHERE CodeTr IN ('BD-BCA', 'BD-BCP')
        ORDER BY DateNotes ASC
    `);
    const allHNotes = hNotesSrc.recordset;
    console.log(
        "Fetched " + allHNotes.length + " payment voucher headers (BD-BCA + BD-BCP) from SQL Server.",
    );

    // All D_Notes2 lines (which invoice does this voucher clear?)
    const dNotes2Src = await pool.request().query(`
        SELECT NoId, IdNotes, Contact, NoTr, ClearedAmount, Clear, BranchId
        FROM D_Notes2
        WHERE IdNotes LIKE 'BD-BCA%' OR IdNotes LIKE 'BD-BCP%'
    `);
    const dNotes2ByVoucher: Record<string, any[]> = {};
    for (const row of dNotes2Src.recordset) {
        if (!dNotes2ByVoucher[row.IdNotes]) dNotes2ByVoucher[row.IdNotes] = [];
        dNotes2ByVoucher[row.IdNotes].push(row);
    }

    // All D_Notes1 lines (GL journal entries)
    const dNotes1Src = await pool.request().query(`
        SELECT Id, IdNotes, AccAct, AccBank, GrpCode, Debit, Credit, Descr
        FROM D_Notes1
        WHERE IdNotes LIKE 'BD-BCA%' OR IdNotes LIKE 'BD-BCP%'
    `);
    const dNotes1ByVoucher: Record<string, any[]> = {};
    for (const row of dNotes1Src.recordset) {
        if (!dNotes1ByVoucher[row.IdNotes]) dNotes1ByVoucher[row.IdNotes] = [];
        dNotes1ByVoucher[row.IdNotes].push(row);
    }

    console.log(
        "Fetched " + dNotes2Src.recordset.length + " D_Notes2 lines, " +
        dNotes1Src.recordset.length + " D_Notes1 lines.\n",
    );

    // ── Process each voucher ──────────────────────────────────────────────────

    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (const h of allHNotes) {
        const voucherId = h.IdNotes.trim();

        // Skip already migrated (check both payments AND journals)
        if (existingPaymentRefs.has(voucherId) || existingJournalInvoices.has(voucherId)) {
            skipped++;
            continue;
        }

        const isBCA = h.CodeTr === "BD-BCA"; // Pelunasan Piutang (receivable)
        const paymentType = isBCA ? "receivable" : "payable";

        const contact = contactMap[h.Contact] ?? null;
        const branch = branchMap[(h.BranchId || "").trim()] ?? defaultBranch;
        const voucherDate = new Date(h.DateNotes);
        const dateStr = voucherDate.toISOString().split("T")[0];

        const lines = dNotes2ByVoucher[voucherId] ?? [];
        const glEntries = dNotes1ByVoucher[voucherId] ?? [];

        const totalAmount = Math.abs(h.Invoice || h.Payment || 0);

        if (totalAmount <= 0) {
            console.warn("  SKIP " + voucherId + ": zero amount");
            skipped++;
            continue;
        }

        try {
            await db.transaction(async (tx) => {
                // 1. Insert payment header
                const [payment] = await tx
                    .insert(payments)
                    .values({
                        contactId: contact?.id ?? null,
                        branchId: branch?.id ?? null,
                        date: dateStr,
                        type: paymentType,
                        totalAmount,
                        status: "posted",
                        reference: voucherId,
                        note: (h.Descr || "").trim() || null,
                    })
                    .returning();

                // 2. Insert payment_lines and update open_invoices
                for (const line of lines) {
                    const invoiceNo = (line.NoTr || "").trim();
                    const cleared = Math.abs(line.ClearedAmount || 0);
                    if (cleared <= 0) continue;

                    const openInvoice = openInvoiceByInvoice[invoiceNo];
                    if (!openInvoice) {
                        console.warn(
                            "    WARN " + voucherId + ": open invoice not found for NoTr=" + invoiceNo,
                        );
                        continue;
                    }

                    await tx.insert(paymentLines).values({
                        paymentId: payment.id,
                        openInvoiceId: openInvoice.id,
                        amount: cleared,
                    });

                    // Update open_invoices.paidAmount + status
                    const [currentOI] = await tx
                        .select()
                        .from(openInvoices)
                        .where(eq(openInvoices.id, openInvoice.id));

                    if (currentOI) {
                        const newPaidAmount = Number(currentOI.paidAmount ?? 0) + cleared;
                        const newStatus = determinePaidStatus(
                            newPaidAmount,
                            Number(currentOI.amount),
                        );

                        await tx
                            .update(openInvoices)
                            .set({ paidAmount: newPaidAmount, status: newStatus, updatedAt: new Date() })
                            .where(eq(openInvoices.id, openInvoice.id));

                        if (currentOI.transactionId) {
                            const txStatus = determineTxStatus(newStatus);
                            await tx
                                .update(transactions)
                                .set({ status: txStatus, updatedAt: new Date() })
                                .where(eq(transactions.id, currentOI.transactionId));
                        }
                    }
                }

                // 3. Insert payment_accounts (bank/cash GL, non-JT rows)
                const bankEntries = glEntries.filter((e: any) => e.GrpCode !== "JT");
                for (const entry of bankEntries) {
                    const glCode = (entry.AccAct || "").trim();
                    const gl = glMapByCode[glCode];
                    if (!gl) {
                        console.warn("    WARN " + voucherId + ": GL '" + glCode + "' not found, skipping payment account");
                        continue;
                    }

                    const rawAmt = isBCA
                        ? entry.Debit - entry.Credit
                        : entry.Credit - entry.Debit;

                    await tx.insert(paymentAccounts).values({
                        paymentId: payment.id,
                        glAccountId: gl.id,
                        amount: Math.abs(rawAmt),
                    });
                }

                // 4. Create Journal + Journal Entries from all D_Notes1 rows
                const journalDesc =
                    (isBCA ? "Pelunasan Piutang: " : "Pelunasan Hutang: ") +
                    ((h.Descr || "").trim() || voucherId);

                const [journal] = await tx
                    .insert(journals)
                    .values({
                        invoice: voucherId,
                        date: dateStr,
                        description: journalDesc,
                        status: "posted",
                        transactionId: null,
                        branchId: branch?.id ?? null,
                    })
                    .returning();

                for (const entry of glEntries) {
                    const glCode = (entry.AccAct || "").trim();
                    const gl = glMapByCode[glCode];
                    if (!gl) {
                        console.warn("    WARN " + voucherId + ": GL '" + glCode + "' not found for journal entry");
                        continue;
                    }

                    const debit = Math.abs(entry.Debit || 0);
                    const credit = Math.abs(entry.Credit || 0);
                    if (debit <= 0 && credit <= 0) continue;

                    await tx.insert(journalEntries).values({
                        journalId: journal.id,
                        glAccountId: gl.id,
                        debit,
                        credit,
                        note: (entry.Descr || "").trim() || journalDesc,
                    });
                }
            });

            created++;
            if (created % 100 === 0) {
                console.log("  Migrated " + created + " payments so far...");
            }
        } catch (err) {
            errors++;
            console.error("  ERROR migrating " + voucherId + ":", err);
        }
    }

    await pool.close();

    console.log("\n" + "=".repeat(60));
    console.log("Migration Stage 4 Complete");
    console.log("  Created : " + created);
    console.log("  Skipped : " + skipped + " (already migrated or zero amount)");
    console.log("  Errors  : " + errors);
    console.log("=".repeat(60));
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
