import { db } from "@/db";
import {
    accountMappings,
    glAccounts,
    journalEntries,
    journals,
    settings,
} from "@/db/schemas";
import { and, asc, eq, ilike, or, sql } from "drizzle-orm";

export async function findGlAccountByCode(code: string, tx?: any) {
    const dbClient = tx || db;
    const result = await dbClient
        .select({ id: glAccounts.id })
        .from(glAccounts)
        .where(eq(glAccounts.code, code))
        .limit(1);
    return result[0]?.id || null;
}

export class AccountMappingRequiredError extends Error {
    public readonly statusCode: number = 400;
    constructor(public readonly mappingLabel: string) {
        super(
            `Pemetaan akun untuk "${mappingLabel}" belum diatur di Pengaturan Global. Silakan lengkapi pengaturan pemetaan akun di menu Pengaturan terlebih dahulu sebelum melakukan posting transaksi.`
        );
        this.name = "AccountMappingRequiredError";
    }
}

export async function requireGlAccount(
    getFn: (tx?: any) => Promise<string | null>,
    mappingLabel: string,
    tx?: any,
): Promise<string> {
    const id = await getFn(tx);
    if (!id) {
        throw new AccountMappingRequiredError(mappingLabel);
    }
    return id;
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
        const [st] = await dbClient
            .select({ id: settings.paymentAdminFeeGlAccountId })
            .from(settings)
            .limit(1);
        if (st?.id) return st.id;
    } catch {}

    return null;
}

export async function getAccountsPayableGlAccountId(tx?: any) {
    const dbClient = tx || db;
    try {
        const [st] = await dbClient
            .select({ id: settings.apGlAccountId })
            .from(settings)
            .limit(1);
        if (st?.id) return st.id;
    } catch {}

    return null;
}

export async function getAccountsReceivableGlAccountId(tx?: any) {
    const dbClient = tx || db;
    try {
        const [st] = await dbClient
            .select({ id: settings.arGlAccountId })
            .from(settings)
            .limit(1);
        if (st?.id) return st.id;
    } catch {}

    return null;
}

export async function getSalesRevenueGlAccountId(tx?: any) {
    const dbClient = tx || db;
    try {
        const [st] = await dbClient
            .select({ id: settings.salesRevenueGlAccountId })
            .from(settings)
            .limit(1);
        if (st?.id) return st.id;
    } catch {}

    return null;
}

export async function getInputTaxGlAccountId(tx?: any) {
    const dbClient = tx || db;
    try {
        const [st] = await dbClient
            .select({ id: settings.purchaseTaxGlAccountId })
            .from(settings)
            .limit(1);
        if (st?.id) return st.id;
    } catch {}

    return null;
}

export async function getOutputTaxGlAccountId(tx?: any) {
    const dbClient = tx || db;
    try {
        const [st] = await dbClient
            .select({ id: settings.salesTaxGlAccountId })
            .from(settings)
            .limit(1);
        if (st?.id) return st.id;
    } catch {}

    return null;
}

export async function getSalesReturnGlAccountId(tx?: any) {
    const dbClient = tx || db;
    try {
        const [st] = await dbClient
            .select({ id: settings.salesReturnGlAccountId })
            .from(settings)
            .limit(1);
        if (st?.id) return st.id;
    } catch {}

    return null;
}

export async function getPurchaseReturnGlAccountId(tx?: any) {
    const dbClient = tx || db;
    try {
        const [st] = await dbClient
            .select({ id: settings.purchaseReturnGlAccountId })
            .from(settings)
            .limit(1);
        if (st?.id) return st.id;
    } catch {}

    return null;
}

export async function getStockLossGlAccountId(tx?: any) {
    const dbClient = tx || db;
    try {
        const [st] = await dbClient
            .select({ id: settings.stockLossGlAccountId })
            .from(settings)
            .limit(1);
        if (st?.id) return st.id;
    } catch {}

    return null;
}

export async function getStockGainGlAccountId(tx?: any) {
    const dbClient = tx || db;
    try {
        const [st] = await dbClient
            .select({ id: settings.stockGainGlAccountId })
            .from(settings)
            .limit(1);
        if (st?.id) return st.id;
    } catch {}

    return null;
}

export async function getPaymentDiscountGlAccountId(tx?: any) {
    const dbClient = tx || db;
    try {
        const [st] = await dbClient
            .select({ id: settings.paymentDiscountGlAccountId })
            .from(settings)
            .limit(1);
        if (st?.id) return st.id;
    } catch {}

    return null;
}

export async function getPayrollExpenseGlAccountId(tx?: any) {
    const dbClient = tx || db;
    try {
        const [st] = await dbClient
            .select({ id: settings.payrollExpenseGlAccountId })
            .from(settings)
            .limit(1);
        if (st?.id) return st.id;
    } catch {}

    return null;
}

export async function getPayrollPayableGlAccountId(tx?: any) {
    const dbClient = tx || db;
    try {
        const [st] = await dbClient
            .select({ id: settings.payrollPayableGlAccountId })
            .from(settings)
            .limit(1);
        if (st?.id) return st.id;
    } catch {}

    return null;
}
