import sql from "mssql";
import { db } from "../db";
import { journals, journalEntries, glAccounts, branches, users } from "../db/schemas";
import { eq, inArray } from "drizzle-orm";

const mssqlConfig: sql.config = {
    user: "api",
    password: "Hrd12345",
    server: "192.168.5.100",
    port: 1433,
    database: "dbPrimaNusantara",
    options: {
        encrypt: false,
        trustServerCertificate: true,
    },
};

async function fixJournals() {
    console.log("=== 1. UPDATE EXISTING DRAFT JOURNALS TO POSTED ===");
    const updated = await db
        .update(journals)
        .set({ status: "posted" })
        .where(eq(journals.status, "draft"))
        .returning({ id: journals.id, invoice: journals.invoice });
    console.log(`Updated ${updated.length} draft journals to posted.`);

    console.log("\n=== 2. MIGRATE MISSING JOURNALS FROM SQL SERVER ===");
    const pool = await sql.connect(mssqlConfig);

    const missingIds = [
        'BD-BBK/26/10/00015',
        'BD-BCP/26/09/00070',
        'BD-BSJ/26/10/00032',
        'BD-BSJ/26/10/00039'
    ];

    const allBranches = await db.select().from(branches);
    const branchMap = allBranches.reduce((acc, b) => {
        acc[b.code] = b;
        return acc;
    }, {} as Record<string, typeof allBranches[0]>);
    const defaultBranch = allBranches[0];

    const allGl = await db.select().from(glAccounts);
    const glMap = allGl.reduce((acc, g) => {
        acc[g.code] = g;
        return acc;
    }, {} as Record<string, typeof allGl[0]>);

    for (const idNotes of missingIds) {
        const [existing] = await db
            .select()
            .from(journals)
            .where(eq(journals.invoice, idNotes));

        if (existing) {
            console.log(`Journal ${idNotes} already exists in PG, skipping.`);
            continue;
        }

        const hSrc = await pool.request().query(`
            SELECT IdNotes, DateNotes, Descr, Approve, BranchId
            FROM H_Notes
            WHERE IdNotes = '${idNotes}'
        `);
        const h = hSrc.recordset[0];
        if (!h) {
            console.log(`Voucher ${idNotes} not found in H_Notes.`);
            continue;
        }

        const branchCode = (h.BranchId || "").trim();
        const assignedBranch = branchMap[branchCode] || defaultBranch;
        const dateStr = h.DateNotes ? new Date(h.DateNotes).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

        const [newJournal] = await db
            .insert(journals)
            .values({
                invoice: idNotes,
                branchId: assignedBranch.id,
                date: dateStr,
                description: h.Descr ? h.Descr.trim() : `Journal ${idNotes}`,
                status: "posted",
            })
            .returning();

        const dSrc = await pool.request().query(`
            SELECT IdNotes, AccAct, DateVl, Descr, Debit, Credit
            FROM D_Notes1
            WHERE IdNotes = '${idNotes}'
        `);

        for (const line of dSrc.recordset) {
            const accCode = (line.AccAct || "").trim();
            const glAcc = glMap[accCode];
            if (!glAcc) {
                console.warn(`GL Account ${accCode} not found for ${idNotes}!`);
                continue;
            }

            await db.insert(journalEntries).values({
                journalId: newJournal.id,
                glAccountId: glAcc.id,
                debit: Math.max(0, Number(line.Debit) || 0),
                credit: Math.max(0, Number(line.Credit) || 0),
                note: line.Descr ? line.Descr.trim() : null,
            });
        }
        console.log(`Successfully migrated journal and entries for ${idNotes}`);
    }

    await pool.close();
    console.log("\nDone!");
    process.exit(0);
}

fixJournals().catch(e => {
    console.error(e);
    process.exit(1);
});
