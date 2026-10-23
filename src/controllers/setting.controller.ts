import { Request, Response } from "express";
import { db } from "@/db";
import { settings, glAccounts } from "@/db/schemas";
import { eq } from "drizzle-orm";

export const getSettings = async (req: Request, res: Response) => {
    try {
        const result = await db.query.settings.findFirst({
            where: eq(settings.id, "global"),
        });

        res.json(result);
    } catch (error) {
        console.error("Error fetching settings", error);
        res.status(500).json({ message: "Server Error" });
    }
};

export const updateSettings = async (req: Request, res: Response) => {
    try {
        const {
            posRound2Digit,
            allowNegativeStock,
            enableInventoryTracking,
            roundingDifferenceGlAccountId,
            minDateOffset,
            maxDateOffset,
            lockSalesPrice,
            enableTax,
            purchasePrefix,
            salesPrefix,
            salesReturnPrefix,
            purchaseReturnPrefix,
            transferStockPrefix,
            adjustmentPrefix,
            posSalesPrefix,
            expensePrefix,
            generalJournalPrefix,
            expenseJournalPrefix,
            salesJournalPrefix,
            purchaseJournalPrefix,
            arPaymentJournalPrefix,
            apPaymentJournalPrefix,
            salesReturnJournalPrefix,
            purchaseReturnJournalPrefix,
            adjustmentJournalPrefix,
            posJournalPrefix,
            closingJournalPrefix,
            retainedEarningsGlAccountId,
            closingDate,
            printLayouts,
        } = req.body;

        const valuesToSave = {
            posRound2Digit: Boolean(posRound2Digit),
            allowNegativeStock: Boolean(allowNegativeStock),
            enableInventoryTracking: enableInventoryTracking ?? true,
            roundingDifferenceGlAccountId: roundingDifferenceGlAccountId ? roundingDifferenceGlAccountId : null,
            minDateOffset: minDateOffset !== undefined && minDateOffset !== null && minDateOffset !== "" ? Number(minDateOffset) : -365,
            maxDateOffset: maxDateOffset !== undefined && maxDateOffset !== null && maxDateOffset !== "" ? Number(maxDateOffset) : 30,
            lockSalesPrice: Boolean(lockSalesPrice),
            enableTax: enableTax ?? true,
            purchasePrefix: purchasePrefix ? purchasePrefix.trim().toUpperCase() : "PUR",
            salesPrefix: salesPrefix ? salesPrefix.trim().toUpperCase() : "SLS",
            salesReturnPrefix: salesReturnPrefix ? salesReturnPrefix.trim().toUpperCase() : "SLR",
            purchaseReturnPrefix: purchaseReturnPrefix ? purchaseReturnPrefix.trim().toUpperCase() : "PCR",
            transferStockPrefix: transferStockPrefix ? transferStockPrefix.trim().toUpperCase() : "TRF",
            adjustmentPrefix: adjustmentPrefix ? adjustmentPrefix.trim().toUpperCase() : "ADJ",
            posSalesPrefix: posSalesPrefix ? posSalesPrefix.trim().toUpperCase() : "POS",
            expensePrefix: expensePrefix ? expensePrefix.trim().toUpperCase() : "EXP",
            generalJournalPrefix: generalJournalPrefix ? generalJournalPrefix.trim().toUpperCase() : "JRL",
            expenseJournalPrefix: expenseJournalPrefix ? expenseJournalPrefix.trim().toUpperCase() : "EXP",
            salesJournalPrefix: salesJournalPrefix ? salesJournalPrefix.trim().toUpperCase() : "SLS",
            purchaseJournalPrefix: purchaseJournalPrefix ? purchaseJournalPrefix.trim().toUpperCase() : "PUR",
            arPaymentJournalPrefix: arPaymentJournalPrefix ? arPaymentJournalPrefix.trim().toUpperCase() : "AR",
            apPaymentJournalPrefix: apPaymentJournalPrefix ? apPaymentJournalPrefix.trim().toUpperCase() : "AP",
            salesReturnJournalPrefix: salesReturnJournalPrefix ? salesReturnJournalPrefix.trim().toUpperCase() : "SLR",
            purchaseReturnJournalPrefix: purchaseReturnJournalPrefix ? purchaseReturnJournalPrefix.trim().toUpperCase() : "PCR",
            adjustmentJournalPrefix: adjustmentJournalPrefix ? adjustmentJournalPrefix.trim().toUpperCase() : "ADJ",
            posJournalPrefix: posJournalPrefix ? posJournalPrefix.trim().toUpperCase() : "POS",
            closingJournalPrefix: closingJournalPrefix ? closingJournalPrefix.trim().toUpperCase() : "CLS",
            retainedEarningsGlAccountId: retainedEarningsGlAccountId ? retainedEarningsGlAccountId : null,
            ...(closingDate !== undefined ? { closingDate: closingDate || null } : {}),
            ...(printLayouts !== undefined ? { printLayouts } : {}),
            updatedAt: new Date(),
        };

        await db
            .insert(settings)
            .values({
                id: "global",
                ...valuesToSave,
            })
            .onConflictDoUpdate({
                target: settings.id,
                set: valuesToSave,
            });

        res.json({ message: "Settings updated successfully" });
    } catch (error: any) {
        console.error("Error updating settings", error);
        res.status(500).json({ message: "Server Error", error: error.message });
    }
};

