import { and, eq } from "drizzle-orm";
import { db } from "..";
import { accountMappings } from "../schemas";

const defaultMappings = [
    {
        type: "purchase",
        side: "debit",
        glAccountCode: "1400",
        note: "pembelian masuk ke persediaan (Inventory)",
    },
    {
        type: "purchase",
        side: "credit",
        glAccountCode: "2100",
        note: "pembelian masuk ke hutang usaha (AP)",
    },

    {
        type: "sales",
        side: "debit",
        glAccountCode: "1300",
        note: "penjualan ke piutang",
    },
    {
        type: "sales",
        side: "credit",
        glAccountCode: "4100",
        note: "penjualan ke pendapatan",
    },
    {
        type: "sales_return",
        side: "debit",
        glAccountCode: "4100",
        note: "retur penjualan mengurangi pendapatan",
    },
    {
        type: "sales_return",
        side: "credit",
        glAccountCode: "2100",
        note: "retur penjualan menjadi hutang ke customer",
    },
    {
        type: "purchase_return",
        side: "debit",
        glAccountCode: "1300",
        note: "retur pembelian menjadi piutang ke supplier",
    },
    {
        type: "purchase_return",
        side: "credit",
        glAccountCode: "1400",
        note: "retur pembelian mengurangi persediaan",
    },
] as const;

export async function seedAccountMappings(db: typeof import("..").db) {
    for (const map of defaultMappings) {
        const exists = await db
            .select()
            .from(accountMappings)
            .where(
                and(
                    eq(accountMappings.type, map.type),
                    eq(accountMappings.glAccountCode, map.glAccountCode),
                    eq(accountMappings.side, map.side),
                ),
            )
            .limit(1);

        if (exists.length === 0) {
            await db.insert(accountMappings).values(map);
            console.log(
                `seeded mapping ${map.type}-${map.side}-${map.glAccountCode}`,
            );
        } else {
            console.log(
                `skipped mapping ${map.type}-${map.side}-${map.glAccountCode}`,
            );
        }
    }
}
