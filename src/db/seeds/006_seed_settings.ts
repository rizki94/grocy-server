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

    if (existingSettings.length === 0) {
        await dbInstance.insert(settings).values({
            id: "global",
            posRound2Digit: false,
            allowNegativeStock: false,
            roundingDifferenceGlAccountId: roundingDiffGlAccountId,
        });
        console.log("Seeded global settings");
    } else {
        await dbInstance.update(settings).set({
            roundingDifferenceGlAccountId: roundingDiffGlAccountId,
        }).where(eq(settings.id, "global"));
        console.log("Skipped seeding settings, already exists (updated gl account)");
    }
}
