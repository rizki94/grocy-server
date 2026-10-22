/**
 * cleanup-orphan-journals.ts
 * Removes BD-BCA/BD-BCP journals that were created without a matching payment record.
 * Run: npm run cleanup:journals
 */
import { db } from "../db";
import { payments, journals, journalEntries } from "../db/schemas";
import { like, inArray, sql } from "drizzle-orm";

async function main() {
    console.log("Cleaning up orphan BD-BC* journals...");

    // Get all BD-BC* payment references that DO exist
    const existingPmts = await db
        .select({ reference: payments.reference })
        .from(payments)
        .where(like(payments.reference, "BD-BC%"));
    const paidRefs = new Set(existingPmts.map((p) => p.reference).filter(Boolean));
    console.log("Payments with BD-BC* refs:", paidRefs.size);

    // Get all BD-BC* journals
    const allBcJournals = await db
        .select({ id: journals.id, invoice: journals.invoice })
        .from(journals)
        .where(like(journals.invoice, "BD-BC%"));
    console.log("Total BD-BC* journals:", allBcJournals.length);

    // Identify orphans (journal exists but no matching payment)
    const orphanJournals = allBcJournals.filter((j) => !paidRefs.has(j.invoice!));
    console.log("Orphan journals to delete:", orphanJournals.length);

    if (orphanJournals.length === 0) {
        console.log("Nothing to clean up.");
        return;
    }

    const orphanIds = orphanJournals.map((j) => j.id);
    const chunkSize = 200;

    // Delete journal_entries first (FK constraint)
    let deletedEntries = 0;
    for (let i = 0; i < orphanIds.length; i += chunkSize) {
        const chunk = orphanIds.slice(i, i + chunkSize);
        await db.delete(journalEntries).where(inArray(journalEntries.journalId, chunk));
        deletedEntries += chunk.length;
        console.log(`  Deleted journal_entries for chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(orphanIds.length / chunkSize)}`);
    }

    // Delete the journals
    let deletedJournals = 0;
    for (let i = 0; i < orphanIds.length; i += chunkSize) {
        const chunk = orphanIds.slice(i, i + chunkSize);
        await db.delete(journals).where(inArray(journals.id, chunk));
        deletedJournals += chunk.length;
        console.log(`  Deleted journals chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(orphanIds.length / chunkSize)}`);
    }

    console.log("\nCleanup complete.");
    console.log("  Journals deleted:", deletedJournals);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
