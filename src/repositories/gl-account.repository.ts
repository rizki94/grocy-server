import { db } from "@/db";
import { glAccounts, journalEntries, journals } from "@/db/schemas";
import { and, eq, sql } from "drizzle-orm";

export async function findGlAccountByCode(code: string) {
    const result = await db
        .select({ id: glAccounts.id })
        .from(glAccounts)
        .where(eq(glAccounts.code, code))
        .limit(1);
    return result[0]?.id;
}

export async function findLeafGlAccounts() {
    return await db
        .select()
        .from(glAccounts)
        .where(
            sql`NOT EXISTS (
        SELECT 1 
        FROM ${glAccounts} child 
        WHERE child.parent_id = ${glAccounts.id}
      )`
        );
}

export async function getAccountBalance(glAccountId: string) {
    const account = await db
        .select()
        .from(glAccounts)
        .where(eq(glAccounts.id, glAccountId))
        .limit(1)
        .then((r) => r[0]);
    if (!account) return 0;

    const result = await db
        .select({
            debit: sql<number>`COALESCE(sum(${journalEntries.debit}), 0)`,
            credit: sql<number>`COALESCE(sum(${journalEntries.credit}), 0)`,
        })
        .from(journalEntries)
        .innerJoin(journals, eq(journalEntries.journalId, journals.id))
        .where(
            and(
                eq(journalEntries.glAccountId, glAccountId),
                eq(journals.status, "posted"),
            ),
        )
        .then((r) => r[0]);

    if (!result) return 0;

    if (["asset", "expense"].includes(account.type)) {
        return Number(result.debit) - Number(result.credit);
    } else {
        return Number(result.credit) - Number(result.debit);
    }
}
