import z from "zod";

export const journalInsertSchema = z.object({
    date: z.string(),
    description: z.string(),
    status: z.enum(["draft", "posted", "cancelled"]).default("draft"),
});

export const journalEntriesInsertSchema = z.object({
    glAccountId: z.string(),
    debit: z.number(),
    credit: z.number(),
    note: z.string(),
});

export const journalWithEntriesInsertSchema = journalInsertSchema.extend({
    entries: z.array(journalEntriesInsertSchema),
});

export const journalWithEntriesUpdateSchema =
    journalWithEntriesInsertSchema.extend({
        id: z.string(),
    });

export type JournalWithEntriesInsert = z.infer<
    typeof journalWithEntriesInsertSchema
>;

export type JournalWithEntriesUpdate = z.infer<
    typeof journalWithEntriesUpdateSchema
>;
