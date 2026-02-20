import { db } from "./db";
import { glAccounts, journalEntries, journals } from "./db/schemas";
import { and, eq, sql, gte, lte, inArray } from "drizzle-orm";

async function test() {
    try {
        const from = "2026-02-12T05:11:11.975Z";
        const to = "2026-02-19T05:11:11.975Z";

        const fromDate = from.split("T")[0];
        const toDate = to.split("T")[0];

        console.log(`Testing with fromDate: ${fromDate}, toDate: ${toDate}`);
        const query = db
            .select({
                accountName: glAccounts.name,
                accountType: glAccounts.type,
                debit: sql<number>`COALESCE(sum(${journalEntries.debit}), 0)`,
                credit: sql<number>`COALESCE(sum(${journalEntries.credit}), 0)`,
            })
            .from(journalEntries)
            .innerJoin(journals, eq(journalEntries.journalId, journals.id))
            .innerJoin(
                glAccounts,
                eq(journalEntries.glAccountId, glAccounts.id),
            )
            .where(
                and(
                    eq(journals.status, "posted"),
                    gte(journals.date, fromDate),
                    lte(journals.date, toDate),
                    inArray(glAccounts.type, ["income", "expense"]),
                ),
            )
            .groupBy(glAccounts.id, glAccounts.name, glAccounts.type);

        console.log("SQL:", query.toSQL());
        const report = await query;

        console.log("Success! Result count:", report.length);
        console.log("Data:", JSON.stringify(report, null, 2));
    } catch (error: any) {
        console.error("FAILED:", error.message);
        if (error.stack) console.error(error.stack);
    }
    process.exit(0);
}

test();
