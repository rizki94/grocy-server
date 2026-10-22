/**
 * fix-paid-amounts.ts
 *
 * Fixes the double-counted paidAmount on open_invoices.
 *
 * Root cause: fix-open-invoices.ts set paidAmount from D_Notes2 totals,
 * then migrate-stage4 ADDED the same amount on top => doubled.
 *
 * Fix: Recalculate paidAmount from actual payment_lines (the source of truth)
 * and update open_invoices.paidAmount + status accordingly.
 *
 * Run: npx tsx src/scripts/fix-paid-amounts.ts
 */

import { db } from "../db";
import { openInvoices, paymentLines, transactions } from "../db/schemas";
import { eq, sql } from "drizzle-orm";
import dotenv from "dotenv";
dotenv.config();

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

async function main() {
    console.log("=".repeat(60));
    console.log("Fix: Recalculate open_invoices.paidAmount from payment_lines");
    console.log("=".repeat(60) + "\n");

    // 1. Get sum of payment_lines per open_invoice
    console.log("Calculating actual paid amounts from payment_lines...");
    const paymentSums = await db
        .select({
            openInvoiceId: paymentLines.openInvoiceId,
            actualPaid: sql`COALESCE(SUM(${paymentLines.amount}), 0)`,
        })
        .from(paymentLines)
        .groupBy(paymentLines.openInvoiceId);

    const paymentSumMap = new Map();
    for (const row of paymentSums) {
        if (row.openInvoiceId) {
            paymentSumMap.set(row.openInvoiceId, Number(row.actualPaid));
        }
    }

    console.log(`Found payment_lines totals for ${paymentSumMap.size} open_invoices.\n`);

    // 2. Fetch all open_invoices
    const allOI = await db.select().from(openInvoices);
    console.log(`Processing ${allOI.length} open_invoices...\n`);

    let updated = 0;
    let unchanged = 0;

    for (const oi of allOI) {
        const actualPaid = paymentSumMap.get(oi.id) ?? 0;
        const currentPaid = Number(oi.paidAmount ?? 0);
        const totalAmount = Number(oi.amount ?? 0);
        const newStatus = determinePaidStatus(actualPaid, totalAmount);

        if (Math.abs(currentPaid - actualPaid) > 0.01 || oi.status !== newStatus) {
            await db
                .update(openInvoices)
                .set({
                    paidAmount: actualPaid,
                    status: newStatus,
                    updatedAt: new Date(),
                })
                .where(eq(openInvoices.id, oi.id));
            updated++;

            if (updated <= 20) {
                console.log(
                    `  Updated OI ${oi.id}: paid ${currentPaid} -> ${actualPaid}, status ${oi.status} -> ${newStatus}`
                );
            } else if (updated === 21) {
                console.log("  ... (more updates, showing only first 20)");
            }
        } else {
            unchanged++;
        }
    }

    // 3. Also sync transaction statuses
    console.log("\nUpdating transaction statuses...");
    const allOIWithTx = await db
        .select({
            id: openInvoices.id,
            transactionId: openInvoices.transactionId,
            status: openInvoices.status,
        })
        .from(openInvoices);

    let txUpdated = 0;
    for (const oi of allOIWithTx) {
        if (!oi.transactionId) continue;

        let txStatus = "posted";
        if (oi.status === "paid" || oi.status === "overpaid") txStatus = "paid";
        else if (oi.status === "partial") txStatus = "partial";

        await db
            .update(transactions)
            .set({ status: txStatus, updatedAt: new Date() })
            .where(eq(transactions.id, oi.transactionId));
        txUpdated++;
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log("Fix Complete:");
    console.log(`  Open invoices updated: ${updated}`);
    console.log(`  Open invoices unchanged: ${unchanged}`);
    console.log(`  Transaction statuses updated: ${txUpdated}`);
    console.log("=".repeat(60));

    // 4. Summary after fix
    const summary = await db
        .select({
            type: openInvoices.type,
            status: openInvoices.status,
            count: sql`COUNT(*)`,
            totalAmount: sql`SUM(${openInvoices.amount})`,
            totalPaid: sql`SUM(${openInvoices.paidAmount})`,
        })
        .from(openInvoices)
        .groupBy(openInvoices.type, openInvoices.status)
        .orderBy(openInvoices.type, openInvoices.status);

    console.log("\nOpen Invoices Summary After Fix:");
    console.log("-".repeat(80));
    for (const row of summary) {
        console.log(
            `  ${String(row.type).padEnd(12)} ${String(row.status).padEnd(10)} | count: ${String(row.count).padStart(5)} | amount: ${Number(row.totalAmount).toLocaleString("id-ID")} | paid: ${Number(row.totalPaid).toLocaleString("id-ID")}`
        );
    }
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("Fatal error:", err);
        process.exit(1);
    });
