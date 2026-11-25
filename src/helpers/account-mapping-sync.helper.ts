import { settings, accountMappings, glAccounts } from "@/db/schemas";
import { eq } from "drizzle-orm";

export async function syncDbAccountMappings(dbClient: any) {
    const [currentSettings] = await dbClient.select().from(settings).limit(1);
    if (!currentSettings) return;

    const allAccounts = await dbClient.select().from(glAccounts);
    const allMappings = await dbClient.select().from(accountMappings);

    const findByCode = (code: string) => allAccounts.find((a: any) => a.code === code)?.id || null;
    const findByName = (type: string, pattern: RegExp) => 
        allAccounts.find((a: any) => a.type === type && pattern.test(a.name))?.id || null;
    const findFromMapping = (mapType: string, side?: "debit" | "credit") => {
        const m = allMappings.find((x: any) => x.type === mapType && (!side || x.side === side));
        if (m?.glAccountCode) {
            const found = findByCode(m.glAccountCode);
            if (found) return found;
        }
        return null;
    };

    const arGlId = currentSettings.arGlAccountId || 
        findFromMapping("sales", "debit") || 
        findByCode("1300") || 
        findByName("asset", /piutang/i);

    const salesRevenueGlId = currentSettings.salesRevenueGlAccountId || 
        findFromMapping("sales", "credit") || 
        findByCode("4100") || 
        findByName("income", /penjualan/i);

    const salesTaxGlId = currentSettings.salesTaxGlAccountId || 
        findFromMapping("sales_tax", "credit") || 
        findByCode("2200") || 
        findByName("liability", /pajak|ppn/i);

    const apGlId = currentSettings.apGlAccountId || 
        findFromMapping("purchase", "credit") || 
        findByCode("2100") || 
        findByName("liability", /hutang.*(usaha|dagang)/i);

    const purchaseTaxGlId = currentSettings.purchaseTaxGlAccountId || 
        findFromMapping("purchase_tax", "debit") || 
        findByCode("1500") || 
        findByName("asset", /pajak|ppn/i);

    const inventoryGlId = currentSettings.inventoryGlAccountId || 
        findFromMapping("purchase", "debit") || 
        findByCode("1400") || 
        findByName("asset", /persediaan|inventory/i);

    const cogsGlId = currentSettings.cogsGlAccountId || 
        findByCode("5100") || 
        findByName("expense", /hpp|pokok penjualan|cogs/i);

    const salesReturnGlId = currentSettings.salesReturnGlAccountId || 
        findFromMapping("sales_return") || 
        findByCode("4150") || 
        findByName("income", /retur.*penjualan/i) || 
        salesRevenueGlId;

    const purchaseReturnGlId = currentSettings.purchaseReturnGlAccountId || 
        findFromMapping("purchase_return") || 
        inventoryGlId || 
        findByCode("1400");

    const stockLossGlId = currentSettings.stockLossGlAccountId || 
        findByCode("5200") || 
        findByName("expense", /selisih.*stok|pemutihan|penyesuaian.*stok/i) || 
        cogsGlId;

    const stockGainGlId = currentSettings.stockGainGlAccountId || 
        findByCode("4200") || 
        findByName("income", /selisih.*stok|lebih.*stok|pendapatan.*lain/i);

    const paymentAdminFeeGlId = currentSettings.paymentAdminFeeGlAccountId || 
        findByCode("4800") || 
        findByCode("4900") || 
        findByCode("4200") || 
        findByName("income", /admin|fee|layanan|pendapatan.*lain/i);

    const paymentDiscountGlId = currentSettings.paymentDiscountGlAccountId || 
        findByCode("5150") || 
        findByCode("5250") || 
        findByName("expense", /potongan|diskon/i) || 
        cogsGlId;

    const payrollExpenseGlId = currentSettings.payrollExpenseGlAccountId || 
        findByCode("6100") || 
        findByName("expense", /gaji|upah|payroll/i);

    const payrollPayableGlId = currentSettings.payrollPayableGlAccountId || 
        findByCode("2150") || 
        findByName("liability", /gaji/i) || 
        apGlId;

    const retainedEarningsGlId = currentSettings.retainedEarningsGlAccountId || 
        findByCode("3200") || 
        findByName("equity", /laba ditahan|retained/i);

    const roundingDiffGlId = currentSettings.roundingDifferenceGlAccountId || 
        findByCode("5300") || 
        findByName("expense", /pembulatan/i);

    const updates = {
        arGlAccountId: arGlId,
        salesRevenueGlAccountId: salesRevenueGlId,
        salesTaxGlAccountId: salesTaxGlId,
        apGlAccountId: apGlId,
        purchaseTaxGlAccountId: purchaseTaxGlId,
        inventoryGlAccountId: inventoryGlId,
        cogsGlAccountId: cogsGlId,
        salesReturnGlAccountId: salesReturnGlId,
        purchaseReturnGlAccountId: purchaseReturnGlId,
        stockLossGlAccountId: stockLossGlId,
        stockGainGlAccountId: stockGainGlId,
        paymentAdminFeeGlAccountId: paymentAdminFeeGlId,
        paymentDiscountGlAccountId: paymentDiscountGlId,
        payrollExpenseGlAccountId: payrollExpenseGlId,
        payrollPayableGlAccountId: payrollPayableGlId,
        retainedEarningsGlAccountId: retainedEarningsGlId,
        roundingDifferenceGlAccountId: roundingDiffGlId,
    };

    await dbClient.update(settings).set(updates).where(eq(settings.id, "global"));
    return updates;
}
