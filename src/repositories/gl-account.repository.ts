import { db } from "@/db";
import {
    accountMappings,
    glAccounts,
    journalEntries,
    journals,
    settings,
} from "@/db/schemas";
import { and, asc, eq, ilike, or, sql } from "drizzle-orm";

export async function findGlAccountByCode(code: string) {
    const result = await db
        .select({ id: glAccounts.id })
        .from(glAccounts)
        .where(eq(glAccounts.code, code))
        .limit(1);
    return result[0]?.id;
}

export async function getCogsGlAccountId(tx?: any) {
    const dbClient = tx || db;
    try {
        const [st] = await dbClient
            .select({ id: settings.cogsGlAccountId })
            .from(settings)
            .limit(1);
        if (st?.id) return st.id;
    } catch {}

    const [cogsByName] = await dbClient
        .select({ id: glAccounts.id })
        .from(glAccounts)
        .where(
            and(
                eq(glAccounts.type, "expense"),
                or(
                    ilike(glAccounts.name, "%hpp%"),
                    ilike(glAccounts.name, "%pokok penjualan%"),
                    ilike(glAccounts.name, "%cogs%"),
                ),
            ),
        )
        .limit(1);
    if (cogsByName?.id) return cogsByName.id;

    const direct5100 = await findGlAccountByCode("5100");
    if (direct5100) return direct5100;

    return null;
}

export async function getInventoryGlAccountId(tx?: any) {
    const dbClient = tx || db;
    try {
        const [st] = await dbClient
            .select({ id: settings.inventoryGlAccountId })
            .from(settings)
            .limit(1);
        if (st?.id) return st.id;
    } catch {}

    try {
        const [purchaseMap] = await dbClient
            .select()
            .from(accountMappings)
            .where(
                and(
                    eq(accountMappings.type, "purchase"),
                    eq(accountMappings.side, "debit"),
                ),
            )
            .limit(1);
        if (purchaseMap?.glAccountCode) {
            const id = await findGlAccountByCode(purchaseMap.glAccountCode);
            if (id) return id;
        }
    } catch {}

    const [invByName] = await dbClient
        .select({ id: glAccounts.id })
        .from(glAccounts)
        .where(
            and(
                eq(glAccounts.type, "asset"),
                or(
                    ilike(glAccounts.name, "%persediaan%"),
                    ilike(glAccounts.name, "%inventory%"),
                ),
            ),
        )
        .limit(1);
    if (invByName?.id) return invByName.id;

    const direct1400 = await findGlAccountByCode("1400");
    if (direct1400) return direct1400;

    return null;
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
        )
        .orderBy(asc(glAccounts.code));
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

export async function getAdminFeeGlAccountId(specificGlId?: string | null, tx?: any) {
    if (specificGlId) return specificGlId;
    const dbClient = tx || db;
    try {
        const [feeByName] = await dbClient
            .select({ id: glAccounts.id })
            .from(glAccounts)
            .where(
                and(
                    eq(glAccounts.type, "income"),
                    or(
                        ilike(glAccounts.name, "%admin%"),
                        ilike(glAccounts.name, "%fee%"),
                        ilike(glAccounts.name, "%layanan%"),
                        ilike(glAccounts.name, "%pendapatan lain%"),
                    ),
                ),
            )
            .limit(1);
        if (feeByName?.id) return feeByName.id;
    } catch {}

    const direct4800 = await findGlAccountByCode("4800");
    if (direct4800) return direct4800;

    const direct4900 = await findGlAccountByCode("4900");
    if (direct4900) return direct4900;

    return null;
}
