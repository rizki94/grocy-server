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

        await db.update(settings).set({
            posRound2Digit,
            allowNegativeStock,
            enableInventoryTracking: enableInventoryTracking ?? true,
            roundingDifferenceGlAccountId,
            ...(minDateOffset !== undefined ? { minDateOffset: Number(minDateOffset) } : {}),
            ...(maxDateOffset !== undefined ? { maxDateOffset: Number(maxDateOffset) } : {}),
            ...(lockSalesPrice !== undefined ? { lockSalesPrice } : {}),
            ...(enableTax !== undefined ? { enableTax } : {}),
            ...(purchasePrefix ? { purchasePrefix: purchasePrefix.trim().toUpperCase() } : {}),
            ...(salesPrefix ? { salesPrefix: salesPrefix.trim().toUpperCase() } : {}),
            ...(salesReturnPrefix ? { salesReturnPrefix: salesReturnPrefix.trim().toUpperCase() } : {}),
            ...(purchaseReturnPrefix ? { purchaseReturnPrefix: purchaseReturnPrefix.trim().toUpperCase() } : {}),
            ...(transferStockPrefix ? { transferStockPrefix: transferStockPrefix.trim().toUpperCase() } : {}),
            ...(adjustmentPrefix ? { adjustmentPrefix: adjustmentPrefix.trim().toUpperCase() } : {}),
            ...(posSalesPrefix ? { posSalesPrefix: posSalesPrefix.trim().toUpperCase() } : {}),
            ...(expensePrefix ? { expensePrefix: expensePrefix.trim().toUpperCase() } : {}),
            ...(generalJournalPrefix ? { generalJournalPrefix: generalJournalPrefix.trim().toUpperCase() } : {}),
            ...(expenseJournalPrefix ? { expenseJournalPrefix: expenseJournalPrefix.trim().toUpperCase() } : {}),
            ...(salesJournalPrefix ? { salesJournalPrefix: salesJournalPrefix.trim().toUpperCase() } : {}),
            ...(purchaseJournalPrefix ? { purchaseJournalPrefix: purchaseJournalPrefix.trim().toUpperCase() } : {}),
            ...(arPaymentJournalPrefix ? { arPaymentJournalPrefix: arPaymentJournalPrefix.trim().toUpperCase() } : {}),
            ...(apPaymentJournalPrefix ? { apPaymentJournalPrefix: apPaymentJournalPrefix.trim().toUpperCase() } : {}),
            ...(salesReturnJournalPrefix ? { salesReturnJournalPrefix: salesReturnJournalPrefix.trim().toUpperCase() } : {}),
            ...(purchaseReturnJournalPrefix ? { purchaseReturnJournalPrefix: purchaseReturnJournalPrefix.trim().toUpperCase() } : {}),
            ...(adjustmentJournalPrefix ? { adjustmentJournalPrefix: adjustmentJournalPrefix.trim().toUpperCase() } : {}),
            ...(posJournalPrefix ? { posJournalPrefix: posJournalPrefix.trim().toUpperCase() } : {}),
            ...(closingJournalPrefix ? { closingJournalPrefix: closingJournalPrefix.trim().toUpperCase() } : {}),
            ...(retainedEarningsGlAccountId !== undefined ? { retainedEarningsGlAccountId } : {}),
            ...(closingDate !== undefined ? { closingDate } : {}),
            ...(printLayouts !== undefined ? { printLayouts } : {}),
            updatedAt: new Date(),
        }).where(eq(settings.id, "global"));

        res.json({ message: "Settings updated successfully" });
    } catch (error) {
        console.error("Error updating settings", error);
        res.status(500).json({ message: "Server Error" });
    }
};

