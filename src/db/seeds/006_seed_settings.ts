import { db } from "@/db";
import { settings, glAccounts } from "@/db/schemas";
import { eq } from "drizzle-orm";

export async function seedSettings(dbInstance: typeof db) {
    const existingSettings = await dbInstance.select().from(settings).limit(1);

    let roundingDiffGlAccountId = null;
    const roundingAcc = await dbInstance
        .select()
        .from(glAccounts)
        .where(eq(glAccounts.code, "5300"))
        .limit(1);

    if (roundingAcc.length > 0) {
        roundingDiffGlAccountId = roundingAcc[0].id;
    }

    let retainedEarningsGlAccountId = null;
    const retainedAcc = await dbInstance
        .select()
        .from(glAccounts)
        .where(eq(glAccounts.code, "3200"))
        .limit(1);

    if (retainedAcc.length > 0) {
        retainedEarningsGlAccountId = retainedAcc[0].id;
    }

    const defaultValues = {
        id: "global",
        posRound2Digit: false,
        allowNegativeStock: false,
        enableInventoryTracking: true,
        roundingDifferenceGlAccountId: roundingDiffGlAccountId,
        retainedEarningsGlAccountId: retainedEarningsGlAccountId,
        minDateOffset: -365,
        maxDateOffset: 30,
        lockSalesPrice: false,
        enableTax: true,
        purchasePrefix: "PUR",
        salesPrefix: "SLS",
        salesReturnPrefix: "SLR",
        purchaseReturnPrefix: "PCR",
        transferStockPrefix: "TRF",
        adjustmentPrefix: "ADJ",
        posSalesPrefix: "POS",
        expensePrefix: "EXP",
        incomePrefix: "INC",
        generalJournalPrefix: "JRL",
        expenseJournalPrefix: "EXP",
        incomeJournalPrefix: "INC",
        salesJournalPrefix: "SLS",
        purchaseJournalPrefix: "PUR",
        arPaymentJournalPrefix: "AR",
        apPaymentJournalPrefix: "AP",
        salesReturnJournalPrefix: "SLR",
        purchaseReturnJournalPrefix: "PCR",
        adjustmentJournalPrefix: "ADJ",
        posJournalPrefix: "POS",
        closingJournalPrefix: "CLS",
    };

    if (existingSettings.length === 0) {
        await dbInstance.insert(settings).values(defaultValues);
        console.log("Seeded global settings");
    } else {
        await dbInstance
            .update(settings)
            .set({
                roundingDifferenceGlAccountId: roundingDiffGlAccountId,
                retainedEarningsGlAccountId: retainedEarningsGlAccountId,
            })
            .where(eq(settings.id, "global"));
        console.log(
            "Skipped seeding settings, already exists (updated gl accounts)",
        );
    }
}

