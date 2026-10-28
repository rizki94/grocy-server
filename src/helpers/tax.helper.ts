import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schemas/setting.schema";

export async function isTaxEnabled(): Promise<boolean> {
    const [globalSettings] = await db
        .select({ enableTax: settings.enableTax })
        .from(settings)
        .where(eq(settings.id, "global"))
        .limit(1);

    return globalSettings?.enableTax ?? true;
}

export function withoutTax<
    T extends {
        subtotal: number;
        totalDiscount: number;
        totalTax: number;
        totalAmount: number;
        details: Array<{ taxRate: number }>;
    },
>(transaction: T): T {
    return {
        ...transaction,
        totalTax: 0,
        totalAmount: transaction.subtotal - transaction.totalDiscount,
        details: transaction.details.map((detail) => ({
            ...detail,
            taxRate: 0,
        })),
    };
}
