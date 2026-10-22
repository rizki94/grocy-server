import { db } from "@/db";
import { settings } from "@/db/schemas";
import { eq } from "drizzle-orm";
import { AppError } from "@/middleware/error-handler";

/**
 * Get the global closing/lock date from settings
 */
export async function getClosingDate(): Promise<string | null> {
    const globalSettings = await db.query.settings.findFirst({
        where: eq(settings.id, "global"),
        columns: {
            closingDate: true,
        },
    });

    return globalSettings?.closingDate || null;
}

/**
 * Validates that a given transaction/journal date is not on or prior to the closing date.
 * Throws AppError(..., 400) if within a closed period.
 */
export async function validatePeriodNotClosed(
    date: string | Date | undefined | null,
    action: string = "modify"
): Promise<void> {
    if (!date) return;

    const closingDate = await getClosingDate();
    if (!closingDate) return;

    const targetDateStr =
        date instanceof Date
            ? date.toISOString().split("T")[0]
            : String(date).split("T")[0];

    const closingDateStr = String(closingDate).split("T")[0];

    if (targetDateStr <= closingDateStr) {
        throw new AppError(
            `Periode transaksi telah ditutup (sampai ${closingDateStr}). Transaksi pada atau sebelum tanggal tersebut tidak dapat ${action}.`,
            400
        );
    }
}

/**
 * Express middleware to validate period lock on transaction create/update/post/cancel
 */
export async function checkPeriodForTransactionMutation(
    req: import("express").Request,
    res: import("express").Response,
    next: import("express").NextFunction
) {
    try {
        const bodyDate = req.body?.date || req.body?.transaction?.date;
        if (bodyDate) {
            await validatePeriodNotClosed(bodyDate, "dibuat atau diproses");
        }

        const id = req.params?.id;
        if (id) {
            const { transactions, expenses, incomes } = await import("@/db/schemas");
            const [existingTx] = await db
                .select({ date: transactions.date })
                .from(transactions)
                .where(eq(transactions.id, id))
                .limit(1);

            if (existingTx?.date) {
                await validatePeriodNotClosed(existingTx.date, "diubah atau dibatalkan");
            } else {
                const [existingExp] = await db
                    .select({ date: expenses.date })
                    .from(expenses)
                    .where(eq(expenses.id, id))
                    .limit(1);

                if (existingExp?.date) {
                    await validatePeriodNotClosed(existingExp.date, "diubah atau dibatalkan");
                } else {
                    const [existingInc] = await db
                        .select({ date: incomes.date })
                        .from(incomes)
                        .where(eq(incomes.id, id))
                        .limit(1);

                    if (existingInc?.date) {
                        await validatePeriodNotClosed(existingInc.date, "diubah atau dibatalkan");
                    }
                }
            }
        }

        next();
    } catch (err: any) {
        return res.status(err.statusCode || 400).json({
            message: err.message || "Period is closed for this transaction",
        });
    }
}
