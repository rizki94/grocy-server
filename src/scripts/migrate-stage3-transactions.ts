import sql from "mssql";
import { db } from "../db";
import { eq, inArray, and } from "drizzle-orm";
import {
    branches,
    warehouses,
    contacts,
    products,
    productDetails,
    transactions,
    transactionDetails,
    stocks,
    stockMovements,
    journals,
    journalEntries,
    openInvoices,
    glAccounts,
    users,
} from "../db/schemas";
import { addDays } from "../helpers/add-days";

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

type TrxType = "sales" | "purchase" | "sales_return" | "purchase_return" | "transfer_stock" | "adjustment";

function mapGrpCodeToType(grpCode?: string, codeTr?: string, noTr?: string): TrxType {
    const grp = (grpCode || "").trim().toUpperCase();
    const code = (codeTr || "").trim().toUpperCase();
    const inv = (noTr || "").trim().toUpperCase();

    // 1. Match from MstGrpCode
    if (grp === "SJ" || grp === "SO") return "sales";
    if (grp === "PJ" || grp === "PO") return "purchase";
    if (grp === "PR" || grp === "RP") return "purchase_return";
    if (grp === "SR") return "sales_return";
    if (grp === "JT" || grp === "IT") return "transfer_stock";

    // 2. Match from MstCodeTr
    if (code.includes("BSJ") || code.endsWith("SJ") || code.endsWith("SRK")) return "sales";
    if (code.includes("BPJ") || code.endsWith("PJ") || code.endsWith("PRK")) return "purchase";
    if (code.includes("BPR") || code.endsWith("PR") || code.includes("RPR") || code.includes("BRP")) return "purchase_return";
    if (code.includes("BSR") || code.endsWith("SR") || code.includes("RSR")) return "sales_return";
    if (code.includes("BJT") || code.endsWith("JT")) return "transfer_stock";

    // 3. Match from NoTr invoice pattern
    if (inv.includes("BSJ") || inv.includes("SRK")) return "sales";
    if (inv.includes("BPJ") || inv.includes("PRK")) return "purchase";
    if (inv.includes("BPR") || inv.includes("RPR") || inv.includes("BRP")) return "purchase_return";
    if (inv.includes("BSR") || inv.includes("RSR")) return "sales_return";
    if (inv.includes("BJT")) return "transfer_stock";

    return "sales";
}

async function main() {
    console.log("=================================================");
    console.log("Starting Migration Stage 3: Transactions & Journals");
    console.log("Source: SQL Server dbPrimaNusantara (192.168.5.100)");
    console.log("Target: Grocy PostgreSQL Database");
    console.log("=================================================\n");

    const pool = await sql.connect(mssqlConfig);
    console.log("Connected to SQL Server successfully.\n");

    // Load Lookup Mappings from Postgres
    console.log("Loading system lookup maps...");
    const allBranches = await db.select().from(branches);
    const defaultBranch = allBranches.find((b) => b.isHq) || allBranches[0];
    const branchMap: Record<string, typeof branches.$inferSelect> = {};
    for (const b of allBranches) branchMap[b.code] = b;

    let [adminUser] = await db.select().from(users).where(eq(users.username, "super_admin")).limit(1);
    if (!adminUser) {
        [adminUser] = await db.select().from(users).limit(1);
    }

    const allWarehouses = await db.select().from(warehouses);
    const defaultWarehouse = allWarehouses[0];

    // Load SQL Server Location ID to Warehouse map
    const locSrc = await pool.request().query("SELECT AccLoc, Descr FROM MstLocation");
    const warehouseMap: Record<number, typeof warehouses.$inferSelect> = {};
    for (const l of locSrc.recordset) {
        const name = (l.Descr || "").trim();
        const found = allWarehouses.find((w) => w.name.toLowerCase() === name.toLowerCase());
        if (found) warehouseMap[l.AccLoc] = found;
    }

    // Load Contacts map
    const contactsSrc = await pool.request().query("SELECT Contact, CompanyName FROM MstContact");
    const allContacts = await db.select().from(contacts);
    const contactMap: Record<number, typeof contacts.$inferSelect> = {};
    for (const c of contactsSrc.recordset) {
        const name = (c.CompanyName || `Contact ${c.Contact}`).trim();
        const found = allContacts.find((ct) => ct.name.toLowerCase() === name.toLowerCase());
        if (found) contactMap[c.Contact] = found;
    }

    // Load Products & Details map by SKU
    const allDetails = await db.select().from(productDetails);
    const detailBySku: Record<string, typeof productDetails.$inferSelect> = {};
    for (const d of allDetails) {
        detailBySku[d.skuId] = d;
    }

    // Load GL Accounts map by code
    const allGl = await db.select().from(glAccounts);
    const glMapByCode: Record<string, typeof glAccounts.$inferSelect> = {};
    for (const g of allGl) {
        glMapByCode[g.code] = g;
    }

    // ==========================================
    // 1. Transactions (H_transaction & D_transaction)
    // ==========================================
    console.log("\n1. Migrating Transactions (H_transaction & D_transaction)...");
    const hTrxSrc = await pool.request().query(`
        SELECT Id, NoTr, GrpCode, CodeTr, DateTr, DueDate, TermTOP, Status, NoRef,
               Contact, GAmount, Disc, NetAmount, VAT, BranchId
        FROM H_transaction
        ORDER BY DateTr ASC
    `);

    console.log(`   Fetched ${hTrxSrc.recordset.length} transaction headers from SQL Server.`);

    const dTrxSrc = await pool.request().query(`
        SELECT Id, NoTr, AccLoc, PKey, Ndc, Qty, Up, GAmount, Discount, Amount, Cos, TotalCOS, Rat
        FROM D_transaction
    `);

    console.log(`   Fetched ${dTrxSrc.recordset.length} transaction details from SQL Server.`);

    // Group details by NoTr
    const detailsByNoTr: Record<string, any[]> = {};
    for (const d of dTrxSrc.recordset) {
        const noTr = (d.NoTr || "").trim();
        if (!detailsByNoTr[noTr]) detailsByNoTr[noTr] = [];
        detailsByNoTr[noTr].push(d);
    }

    let insertedTrxCount = 0;
    let insertedDetailsCount = 0;

    // Track stock balances per product & warehouse (in base units)
    const stockQtyMap: Record<string, { productId: string; warehouseId: string; qty: number }> = {};

    for (const h of hTrxSrc.recordset) {
        const invoice = (h.NoTr || "").trim();
        if (!invoice) continue;

        const [existing] = await db
            .select()
            .from(transactions)
            .where(eq(transactions.invoice, invoice))
            .limit(1);

        if (existing) continue;

        const type = mapGrpCodeToType(h.GrpCode, h.CodeTr, h.NoTr);
        const branchCode = (h.BranchId || "").trim();
        const assignedBranch = branchMap[branchCode] || defaultBranch;
        const contact = contactMap[h.Contact];
        const dateStr = h.DateTr ? new Date(h.DateTr).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
        const subtotal = Math.max(0, Number(h.GAmount) || 0);
        const totalAmount = Math.max(0, Number(h.NetAmount) || subtotal);
        const totalDiscount = Math.max(0, Number(h.Disc) || 0);
        const totalTax = Math.max(0, Number(h.VAT) || 0);
        const term = Math.min(32767, Math.max(0, Number(h.TermTOP) || 0));

        const [trx] = await db
            .insert(transactions)
            .values({
                type,
                invoice,
                contactId: contact?.id || null,
                date: dateStr,
                termOfPayment: term,
                reference: h.NoRef ? h.NoRef.trim() : null,
                subtotal,
                totalDiscount,
                totalAmount,
                totalTax,
                status: "posted",
                userId: adminUser.id,
                branchId: assignedBranch.id,
            })
            .returning();

        insertedTrxCount++;

        // Process details for this transaction
        const items = detailsByNoTr[invoice] || [];
        for (const item of items) {
            const sku = (item.PKey || "").trim();
            const detail = detailBySku[sku];
            if (!detail) continue;

            const targetWarehouse = warehouseMap[item.AccLoc] || defaultWarehouse;
            const qty = Math.max(0, Number(item.Qty) || 0);
            const unitPrice = Math.max(0, Number(item.Up) || 0);
            const unitCost = Math.max(0, Number(item.Cos) || Number(detail.cost) || 0);
            const itemAmount = Math.max(0, Number(item.Amount) || qty * unitPrice);
            const totalCost = Math.max(0, Number(item.TotalCOS) || qty * unitCost);
            const ratio = Number(item.Rat) || 1;
            const ndc = Number(item.Ndc) || (type === "sales" || type === "purchase_return" ? -1 : 1);
            const movementType = ndc === -1 ? -1 : 1;

            await db.insert(transactionDetails).values({
                transactionId: trx.id,
                productId: detail.productId,
                productDetailId: detail.id,
                warehouseId: targetWarehouse.id,
                movementType,
                qty,
                baseRatio: ratio,
                price: unitPrice,
                unitCost,
                amount: itemAmount,
                totalCost,
            });
            insertedDetailsCount++;

            // Accumulate stock in smallest base units: Ndc * Qty * Rat
            const baseQty = qty * ratio;
            const stockKey = `${detail.productId}_${targetWarehouse.id}`;
            if (!stockQtyMap[stockKey]) {
                stockQtyMap[stockKey] = {
                    productId: detail.productId,
                    warehouseId: targetWarehouse.id,
                    qty: 0,
                };
            }
            if (movementType === -1) {
                stockQtyMap[stockKey].qty -= baseQty;
            } else {
                stockQtyMap[stockKey].qty += baseQty;
            }
        }
    }

    console.log(`   Migrated ${insertedTrxCount} transactions and ${insertedDetailsCount} line items.`);

    // ==========================================
    // 2. Synchronize Current Stocks
    // ==========================================
    console.log("2. Synchronizing current stocks based on transactions...");
    let stockUpdatedCount = 0;
    for (const entry of Object.values(stockQtyMap)) {
        const netQty = Math.max(0, Math.round(entry.qty * 100) / 100);

        const [existingStock] = await db
            .select()
            .from(stocks)
            .where(
                and(
                    eq(stocks.productId, entry.productId),
                    eq(stocks.warehouseId, entry.warehouseId),
                ),
            )
            .limit(1);

        if (!existingStock) {
            await db.insert(stocks).values({
                productId: entry.productId,
                warehouseId: entry.warehouseId,
                qty: netQty,
            });
        } else {
            await db
                .update(stocks)
                .set({ qty: netQty })
                .where(eq(stocks.id, existingStock.id));
        }
        stockUpdatedCount++;
    }
    console.log(`   Synchronized stock records for ${stockUpdatedCount} products.`);

    // ==========================================
    // 3. Journals (H_Notes & D_Notes1)
    // ==========================================
    console.log("\n3. Migrating Journals (H_Notes & D_Notes1)...");
    const hNotesSrc = await pool.request().query(`
        SELECT IdNotes, DateNotes, Descr, Approve, BranchId
        FROM H_Notes
        ORDER BY DateNotes ASC
    `);

    console.log(`   Fetched ${hNotesSrc.recordset.length} journal headers from SQL Server.`);

    const dNotes1Src = await pool.request().query(`
        SELECT IdNotes, AccAct, DateVl, Descr, Debit, Credit
        FROM D_Notes1
    `);

    console.log(`   Fetched ${dNotes1Src.recordset.length} journal entry lines from SQL Server.`);

    // Group entry lines by IdNotes
    const entriesByIdNotes: Record<string, any[]> = {};
    for (const e of dNotes1Src.recordset) {
        const idNotes = (e.IdNotes || "").trim();
        if (!entriesByIdNotes[idNotes]) entriesByIdNotes[idNotes] = [];
        entriesByIdNotes[idNotes].push(e);
    }

    let insertedJournalCount = 0;
    let insertedEntriesCount = 0;

    for (const h of hNotesSrc.recordset) {
        const invoice = (h.IdNotes || "").trim();
        if (!invoice) continue;

        const [existing] = await db
            .select()
            .from(journals)
            .where(eq(journals.invoice, invoice))
            .limit(1);

        if (existing) continue;

        const branchCode = (h.BranchId || "").trim();
        const assignedBranch = branchMap[branchCode] || defaultBranch;
        const dateStr = h.DateNotes ? new Date(h.DateNotes).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
        const status = h.Approve ? ("posted" as const) : ("draft" as const);

        const [journal] = await db
            .insert(journals)
            .values({
                invoice,
                branchId: assignedBranch.id,
                date: dateStr,
                description: h.Descr ? h.Descr.trim() : `Journal ${invoice}`,
                status,
            })
            .returning();

        insertedJournalCount++;

        const entries = entriesByIdNotes[invoice] || [];
        for (const entry of entries) {
            const accCode = (entry.AccAct || "").trim();
            const glAcc = glMapByCode[accCode];
            if (!glAcc) continue;

            const debit = Math.max(0, Number(entry.Debit) || 0);
            const credit = Math.max(0, Number(entry.Credit) || 0);

            await db.insert(journalEntries).values({
                journalId: journal.id,
                glAccountId: glAcc.id,
                debit,
                credit,
                note: entry.Descr ? entry.Descr.trim() : null,
            });
            insertedEntriesCount++;
        }
    }

    console.log(`   Migrated ${insertedJournalCount} journals and ${insertedEntriesCount} journal entries.`);

    // ==========================================
    // 4. Open Invoices & Settlement (D_Notes2)
    // ==========================================
    console.log("\n4. Migrating Open Invoices / Settlement Status (D_Notes2)...");
    const dNotes2Src = await pool.request().query(`
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
    for (const r of dNotes2Src.recordset) {
        settlementMap.set(r.NoTr, {
            totalCleared: Math.abs(Number(r.totalCleared) || 0),
            isClear: Boolean(r.isClear),
            dueDate: r.DueDate ? new Date(r.DueDate).toISOString().slice(0, 10) : undefined,
        });
    }

    const relevantTrx = await db
        .select()
        .from(transactions)
        .where(inArray(transactions.type, ["purchase", "sales", "purchase_return", "sales_return"]));

    let openInvoicesCount = 0;
    for (const trx of relevantTrx) {
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
            openInvoicesCount++;
        } else {
            if (existing.status !== status || Number(existing.paidAmount) !== paidAmount) {
                await db
                    .update(openInvoices)
                    .set({
                        paidAmount,
                        status,
                        dueDate,
                    })
                    .where(eq(openInvoices.id, existing.id));
            }
        }
    }
    console.log(`   Migrated/Verified ${openInvoicesCount} open invoice settlement records.`);

    await pool.close();
    console.log("\n=================================================");
    console.log("Migration Stage 3 (Transactions & Journals) Completed Successfully!");
    console.log("=================================================");
    process.exit(0);
}

main().catch((err) => {
    console.error("\n❌ Migration Stage 3 Failed:", err);
    process.exit(1);
});
