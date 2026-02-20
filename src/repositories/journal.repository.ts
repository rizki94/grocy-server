import { db } from "@/db";
import { journalEntries, journals } from "@/db/schemas";
import {
    JournalWithEntriesInsert,
    JournalWithEntriesUpdate,
} from "@/validators/journal.vaildator";
import { desc, eq } from "drizzle-orm";

export const findAllJournals = async () => {
    return await db.select().from(journals).orderBy(desc(journals.createdAt));
};

export const findJournalById = async (id: string) => {
    return await db
        .select({
            journal: journals,
            entries: journalEntries,
        })
        .from(journals)
        .innerJoin(journalEntries, eq(journals.id, journalEntries.journalId))
        .where(eq(journals.id, id));
};

export async function createJournal(
    data: JournalWithEntriesInsert,
    user: Express.User,
) {
    return await db.transaction(async (tx) => {
        const [journal] = await tx
            .insert(journals)
            .values({
                date: data.date,
                description: data.description,
                status: data.status,
            })
            .returning();

        for (const entry of data.entries) {
            await tx.insert(journalEntries).values({
                journalId: journal.id,
                glAccountId: entry.glAccountId,
                debit: entry.debit,
                credit: entry.credit,
                note: entry.note,
            });
        }

        return journal;
    });
}

export async function updateJournal(data: JournalWithEntriesUpdate) {
    return await db.transaction(async (tx) => {
        const [updatedJournal] = await db
            .update(journals)
            .set(data)
            .where(eq(journals.id, data.id))
            .returning();

        await tx
            .delete(journalEntries)
            .where(eq(journalEntries.journalId, data.id));

        for (const entry of data.entries) {
            await tx.insert(journalEntries).values({
                journalId: data.id,
                glAccountId: entry.glAccountId,
                debit: entry.debit,
                credit: entry.credit,
                note: entry.note,
            });
        }

        return updatedJournal;
    });
}
