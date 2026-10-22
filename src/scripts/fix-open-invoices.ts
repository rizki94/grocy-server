import { db } from "../db";
import { transactions, openInvoices } from "../db/schemas";
import { eq, inArray } from "drizzle-orm";
import { addDays } from "../helpers/add-days";
import sqlServer from "mssql";
import dotenv from "dotenv";
dotenv.config();

const sqlConfig: sqlServer.config = {
    user: process.env.MSSQL_USER || "api",
    password: process.env.MSSQL_PASSWORD || "Hrd12345",
    database: process.env.MSSQL_DATABASE || "dbPrimaNusantara",
    server: process.env.MSSQL_HOST || "192.168.5.100",
    port: Number(process.env.MSSQL_PORT) || 1433,
    options: {
        encrypt: false,
        trustServerCertificate: true,
    },
};

async function fixOpenInvoices() {
    console.log("=== Starting Open Invoices Fix ===");

    // 1. Fetch settlement data from SQL Server D_Notes2
    const pool = await sqlServer.connect(sqlConfig);
    console.log("Connected to SQL Server");

    const settlementsSrc = await pool.request().query(`
        SELECT 
            RTRIM(LTRIM(NoTr)) as NoTr, 
            SUM(ABS(ClearedAmount)) as totalCleared,
            MAX(CASE WHEN Clear = 1 THEN 1 ELSE 0 END) as isClear,
            MAX(DueDate) as DueDate
        FROM D_Notes2
        WHERE NoTr IS NOT NULL AND RTRIM(LTRIM(NoTr)) != ''
        GROUP BY RTRIM(LTRIM(NoTr))
    `);

    const settlementMap = new Map<string, { totalCleared: number; isClear: boolean; dueDate?: string }>();
    for (const r of settlementsSrc.recordset) {
        settlementMap.set(r.NoTr, {
            totalCleared: Math.abs(Number(r.totalCleared) || 0),
            isClear: Boolean(r.isClear),
            dueDate: r.DueDate ? new Date(r.DueDate).toISOString().slice(0, 10) : undefined,
        });
    }
    console.log(`Loaded settlement info for ${settlementMap.size} invoices from SQL Server.`);
    await pool.close();

    // 2. Fetch all relevant transactions from Postgres
    const relevantTypes = ["purchase", "sales", "purchase_return", "sales_return"] as const;
    const allTrx = await db
        .select()
        .from(transactions)
        .where(inArray(transactions.type, relevantTypes));

    console.log(`Found ${allTrx.length} posted transactions in Postgres.`);

    let insertedCount = 0;
    let updatedCount = 0;

    for (const trx of allTrx) {
        const [existing] = await db
            .select()
            .from(openInvoices)
            .where(eq(openInvoices.transactionId, trx.id))
            .limit(1);

        const settlement = settlementMap.get(trx.invoice);
        const totalAmount = Number(trx.totalAmount) || 0;

        let targetType: "payable" | "receivable" = "receivable";
        if (trx.type === "purchase" || trx.type === "sales_return") {
            targetType = "payable";
        } else {
            targetType = "receivable";
        }

        let paidAmount = 0;
        let status: "open" | "partial" | "paid" = "open";

        if (settlement) {
            paidAmount = Math.min(totalAmount, settlement.totalCleared);
            if (settlement.isClear && (paidAmount >= totalAmount || totalAmount === 0)) {
                status = "paid";
            } else if (paidAmount > 0) {
                status = "partial";
            } else {
                status = "open";
            }
        } else {
            paidAmount = 0;
            status = "open";
        }

        const dueDate = settlement?.dueDate || addDays(trx.date, trx.termOfPayment || 0);

        if (!existing) {
            await db.insert(openInvoices).values({
                transactionId: trx.id,
                contactId: trx.contactId,
                branchId: trx.branchId,
                type: targetType,
                dueDate,
                amount: totalAmount,
                paidAmount,
                status,
            });
            insertedCount++;
        } else {
            // Check if status or paidAmount should be updated (e.g. was marked paid incorrectly)
            if (existing.status !== status || Number(existing.paidAmount) !== paidAmount) {
                await db
                    .update(openInvoices)
                    .set({
                        paidAmount,
                        status,
                        dueDate,
                    })
                    .where(eq(openInvoices.id, existing.id));
                updatedCount++;
            }
        }
    }

    console.log(`\nResults:`);
    console.log(`- Created ${insertedCount} missing open_invoices.`);
    console.log(`- Updated ${updatedCount} existing open_invoices.`);

    // Summary of open_invoices after fix
    const summary = await db
        .select({
            type: openInvoices.type,
            status: openInvoices.status,
        })
        .from(openInvoices);

    const counts: Record<string, number> = {};
    for (const s of summary) {
        const key = `${s.type} - ${s.status}`;
        counts[key] = (counts[key] || 0) + 1;
    }
    console.log("\nCurrent open_invoices distribution:", counts);
    console.log("=== Fix Completed Successfully ===");
}

fixOpenInvoices()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("❌ Failed to fix open invoices:", err);
        process.exit(1);
    });
