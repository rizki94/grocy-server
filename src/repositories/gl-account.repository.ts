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
        const [st] = await dbClient
            .select({ id: settings.paymentAdminFeeGlAccountId })
            .from(settings)
            .limit(1);
        if (st?.id) return st.id;
    } catch {}

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

    const direct4800 = await findGlAccountByCode("4800", tx);
    if (direct4800) return direct4800;

    const direct4900 = await findGlAccountByCode("4900", tx);
    if (direct4900) return direct4900;

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

    try {
        const [apMap] = await dbClient
            .select()
            .from(accountMappings)
            .where(
                and(
                    eq(accountMappings.type, "purchase"),
                    eq(accountMappings.side, "credit"),
                ),
            )
            .limit(1);
        if (apMap?.glAccountCode) {
            const id = await findGlAccountByCode(apMap.glAccountCode, tx);
            if (id) return id;
        }
    } catch {}

    try {
        const [apByName] = await dbClient
            .select({ id: glAccounts.id })
            .from(glAccounts)
            .where(
                and(
                    eq(glAccounts.type, "liability"),
                    or(
                        ilike(glAccounts.name, "%hutang usaha%"),
                        ilike(glAccounts.name, "%hutang dagang%"),
                        ilike(glAccounts.name, "%accounts payable%"),
                        ilike(glAccounts.name, "%payable%"),
                        ilike(glAccounts.name, "%hutang%"),
                    ),
                ),
            )
            .limit(1);
        if (apByName?.id) return apByName.id;
    } catch {}

    const direct2100 = await findGlAccountByCode("2100", tx);
    if (direct2100) return direct2100;

    const direct2110 = await findGlAccountByCode("2110", tx);
    if (direct2110) return direct2110;

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

    try {
        const [arMap] = await dbClient
            .select()
            .from(accountMappings)
            .where(
                and(
                    eq(accountMappings.type, "sales"),
                    eq(accountMappings.side, "debit"),
                ),
            )
            .limit(1);
        if (arMap?.glAccountCode) {
            const id = await findGlAccountByCode(arMap.glAccountCode, tx);
            if (id) return id;
        }
    } catch {}

    try {
        const [arByName] = await dbClient
            .select({ id: glAccounts.id })
            .from(glAccounts)
            .where(
                and(
                    eq(glAccounts.type, "asset"),
                    or(
                        ilike(glAccounts.name, "%piutang usaha%"),
                        ilike(glAccounts.name, "%piutang dagang%"),
                        ilike(glAccounts.name, "%accounts receivable%"),
                        ilike(glAccounts.name, "%receivable%"),
                        ilike(glAccounts.name, "%piutang%"),
                    ),
                ),
            )
            .limit(1);
        if (arByName?.id) return arByName.id;
    } catch {}

    const direct1300 = await findGlAccountByCode("1300", tx);
    if (direct1300) return direct1300;

    const direct1310 = await findGlAccountByCode("1310", tx);
    if (direct1310) return direct1310;

    const direct1200 = await findGlAccountByCode("1200", tx);
    if (direct1200) return direct1200;

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

    try {
        const [revMap] = await dbClient
            .select()
            .from(accountMappings)
            .where(
                and(
                    eq(accountMappings.type, "sales"),
                    eq(accountMappings.side, "credit"),
                ),
            )
            .limit(1);
        if (revMap?.glAccountCode) {
            const id = await findGlAccountByCode(revMap.glAccountCode, tx);
            if (id) return id;
        }
    } catch {}

    try {
        const [revByName] = await dbClient
            .select({ id: glAccounts.id })
            .from(glAccounts)
            .where(
                and(
                    eq(glAccounts.type, "income"),
                    or(
                        ilike(glAccounts.name, "%pendapatan penjualan%"),
                        ilike(glAccounts.name, "%penjualan barang%"),
                        ilike(glAccounts.name, "%sales revenue%"),
                        ilike(glAccounts.name, "%penjualan%"),
                    ),
                ),
            )
            .limit(1);
        if (revByName?.id) return revByName.id;
    } catch {}

    const direct4100 = await findGlAccountByCode("4100", tx);
    if (direct4100) return direct4100;

    const direct4110 = await findGlAccountByCode("4110", tx);
    if (direct4110) return direct4110;

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

    try {
        const [taxMap] = await dbClient
            .select()
            .from(accountMappings)
            .where(
                and(
                    or(
                        eq(accountMappings.type, "purchase_tax"),
                        eq(accountMappings.type, "purchase"),
                    ),
                    ilike(accountMappings.note, "%pajak%"),
                ),
            )
            .limit(1);
        if (taxMap?.glAccountCode) {
            const id = await findGlAccountByCode(taxMap.glAccountCode, tx);
            if (id) return id;
        }
    } catch {}

    try {
        const [taxByName] = await dbClient
            .select({ id: glAccounts.id })
            .from(glAccounts)
            .where(
                and(
                    eq(glAccounts.type, "asset"),
                    or(
                        ilike(glAccounts.name, "%ppn masukan%"),
                        ilike(glAccounts.name, "%pajak masukan%"),
                        ilike(glAccounts.name, "%input tax%"),
                        ilike(glAccounts.name, "%ppn masuk%"),
                    ),
                ),
            )
            .limit(1);
        if (taxByName?.id) return taxByName.id;
    } catch {}

    const direct1500 = await findGlAccountByCode("1500", tx);
    if (direct1500) return direct1500;

    const direct1450 = await findGlAccountByCode("1450", tx);
    if (direct1450) return direct1450;

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

    try {
        const [taxMap] = await dbClient
            .select()
            .from(accountMappings)
            .where(
                and(
                    or(
                        eq(accountMappings.type, "sales_tax"),
                        eq(accountMappings.type, "sales"),
                    ),
                    ilike(accountMappings.note, "%pajak%"),
                ),
            )
            .limit(1);
        if (taxMap?.glAccountCode) {
            const id = await findGlAccountByCode(taxMap.glAccountCode, tx);
            if (id) return id;
        }
    } catch {}

    try {
        const [taxByName] = await dbClient
            .select({ id: glAccounts.id })
            .from(glAccounts)
            .where(
                and(
                    eq(glAccounts.type, "liability"),
                    or(
                        ilike(glAccounts.name, "%ppn keluaran%"),
                        ilike(glAccounts.name, "%pajak keluaran%"),
                        ilike(glAccounts.name, "%output tax%"),
                        ilike(glAccounts.name, "%ppn keluar%"),
                    ),
                ),
            )
            .limit(1);
        if (taxByName?.id) return taxByName.id;
    } catch {}

    const direct2200 = await findGlAccountByCode("2200", tx);
    if (direct2200) return direct2200;

    const direct2150 = await findGlAccountByCode("2150", tx);
    if (direct2150) return direct2150;

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

    try {
        const [retMap] = await dbClient
            .select()
            .from(accountMappings)
            .where(eq(accountMappings.type, "sales_return"))
            .limit(1);
        if (retMap?.glAccountCode) {
            const id = await findGlAccountByCode(retMap.glAccountCode, tx);
            if (id) return id;
        }
    } catch {}

    try {
        const [retByName] = await dbClient
            .select({ id: glAccounts.id })
            .from(glAccounts)
            .where(
                and(
                    eq(glAccounts.type, "income"),
                    or(
                        ilike(glAccounts.name, "%retur penjualan%"),
                        ilike(glAccounts.name, "%sales return%"),
                        ilike(glAccounts.name, "%retur%"),
                    ),
                ),
            )
            .limit(1);
        if (retByName?.id) return retByName.id;
    } catch {}

    const direct4150 = await findGlAccountByCode("4150", tx);
    if (direct4150) return direct4150;

    const direct4200 = await findGlAccountByCode("4200", tx);
    if (direct4200) return direct4200;

    return await getSalesRevenueGlAccountId(tx);
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

    try {
        const [retMap] = await dbClient
            .select()
            .from(accountMappings)
            .where(eq(accountMappings.type, "purchase_return"))
            .limit(1);
        if (retMap?.glAccountCode) {
            const id = await findGlAccountByCode(retMap.glAccountCode, tx);
            if (id) return id;
        }
    } catch {}

    try {
        const [retByName] = await dbClient
            .select({ id: glAccounts.id })
            .from(glAccounts)
            .where(
                and(
                    or(eq(glAccounts.type, "asset"), eq(glAccounts.type, "expense")),
                    or(
                        ilike(glAccounts.name, "%retur pembelian%"),
                        ilike(glAccounts.name, "%purchase return%"),
                    ),
                ),
            )
            .limit(1);
        if (retByName?.id) return retByName.id;
    } catch {}

    return await getInventoryGlAccountId(tx);
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

    try {
        const [adjMap] = await dbClient
            .select()
            .from(accountMappings)
            .where(
                and(
                    eq(accountMappings.type, "adjustment"),
                    eq(accountMappings.side, "debit"),
                ),
            )
            .limit(1);
        if (adjMap?.glAccountCode) {
            const id = await findGlAccountByCode(adjMap.glAccountCode, tx);
            if (id) return id;
        }
    } catch {}

    try {
        const [lossByName] = await dbClient
            .select({ id: glAccounts.id })
            .from(glAccounts)
            .where(
                and(
                    eq(glAccounts.type, "expense"),
                    or(
                        ilike(glAccounts.name, "%pemutihan%"),
                        ilike(glAccounts.name, "%selisih persediaan%"),
                        ilike(glAccounts.name, "%penyesuaian persediaan%"),
                        ilike(glAccounts.name, "%selisih barang%"),
                        ilike(glAccounts.name, "%kerusakan%"),
                        ilike(glAccounts.name, "%kehilangan%"),
                        ilike(glAccounts.name, "%inventory loss%"),
                    ),
                ),
            )
            .limit(1);
        if (lossByName?.id) return lossByName.id;
    } catch {}

    const direct5200 = await findGlAccountByCode("5200", tx);
    if (direct5200) return direct5200;

    const direct5300 = await findGlAccountByCode("5300", tx);
    if (direct5300) return direct5300;

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

    try {
        const [adjMap] = await dbClient
            .select()
            .from(accountMappings)
            .where(
                and(
                    eq(accountMappings.type, "adjustment"),
                    eq(accountMappings.side, "credit"),
                ),
            )
            .limit(1);
        if (adjMap?.glAccountCode) {
            const id = await findGlAccountByCode(adjMap.glAccountCode, tx);
            if (id) return id;
        }
    } catch {}

    try {
        const [gainByName] = await dbClient
            .select({ id: glAccounts.id })
            .from(glAccounts)
            .where(
                and(
                    eq(glAccounts.type, "income"),
                    or(
                        ilike(glAccounts.name, "%selisih persediaan%"),
                        ilike(glAccounts.name, "%penyesuaian persediaan%"),
                        ilike(glAccounts.name, "%keuntungan persediaan%"),
                        ilike(glAccounts.name, "%inventory gain%"),
                    ),
                ),
            )
            .limit(1);
        if (gainByName?.id) return gainByName.id;
    } catch {}

    return await getStockLossGlAccountId(tx);
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

    try {
        const [discByName] = await dbClient
            .select({ id: glAccounts.id })
            .from(glAccounts)
            .where(
                and(
                    or(eq(glAccounts.type, "expense"), eq(glAccounts.type, "income")),
                    or(
                        ilike(glAccounts.name, "%potongan penjualan%"),
                        ilike(glAccounts.name, "%diskon pelunasan%"),
                        ilike(glAccounts.name, "%potongan pembayaran%"),
                        ilike(glAccounts.name, "%early payment discount%"),
                    ),
                ),
            )
            .limit(1);
        if (discByName?.id) return discByName.id;
    } catch {}

    const direct4120 = await findGlAccountByCode("4120", tx);
    if (direct4120) return direct4120;

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

    try {
        const [payByName] = await dbClient
            .select({ id: glAccounts.id })
            .from(glAccounts)
            .where(
                and(
                    eq(glAccounts.type, "expense"),
                    or(
                        ilike(glAccounts.name, "%beban gaji%"),
                        ilike(glAccounts.name, "%biaya gaji%"),
                        ilike(glAccounts.name, "%gaji & upah%"),
                        ilike(glAccounts.name, "%gaji dan upah%"),
                        ilike(glAccounts.name, "%salary%"),
                        ilike(glAccounts.name, "%payroll%"),
                        ilike(glAccounts.name, "%gaji%"),
                    ),
                ),
            )
            .limit(1);
        if (payByName?.id) return payByName.id;
    } catch {}

    const direct5210 = await findGlAccountByCode("5210", tx);
    if (direct5210) return direct5210;

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

    try {
        const [payByName] = await dbClient
            .select({ id: glAccounts.id })
            .from(glAccounts)
            .where(
                and(
                    eq(glAccounts.type, "liability"),
                    or(
                        ilike(glAccounts.name, "%hutang gaji%"),
                        ilike(glAccounts.name, "%utang gaji%"),
                        ilike(glAccounts.name, "%accrued salary%"),
                        ilike(glAccounts.name, "%salaries payable%"),
                    ),
                ),
            )
            .limit(1);
        if (payByName?.id) return payByName.id;
    } catch {}

    const direct2120 = await findGlAccountByCode("2120", tx);
    if (direct2120) return direct2120;

    return null;
}
