import { and, eq } from "drizzle-orm";
import { db } from "..";
import { accountMappings } from "../schemas";

const defaultMappings = [
    {
        type: "purchase",
        side: "debit",
        glAccountCode: "1400",
        note: "Persediaan",
    },
    {
        type: "purchase",
        side: "credit",
        glAccountCode: "2100",
        note: "Hutang Usaha",
    },
    {
        type: "sales",
        side: "debit",
        glAccountCode: "1300",
        note: "Piutang Usaha",
    },
    {
        type: "sales",
        side: "credit",
        glAccountCode: "4100",
        note: "Pendapatan Penjualan",
    },
    {
        type: "sales_tax",
        side: "credit",
        glAccountCode: "2200",
        note: "PPN Keluaran",
    },
    {
        type: "purchase_tax",
        side: "debit",
        glAccountCode: "1500",
        note: "PPN Masukan",
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
            await db.insert(accountMappings).values([map as any]);
            console.log(
                `seeded mapping ${map.type}-${map.side}-${map.glAccountCode}`,
            );
        } else {
            await db
                .update(accountMappings)
                .set({ note: map.note })
                .where(
                    and(
                        eq(accountMappings.type, map.type),
                        eq(accountMappings.glAccountCode, map.glAccountCode),
                        eq(accountMappings.side, map.side),
                    ),
                );
            console.log(
                `updated mapping note for ${map.type}-${map.side}-${map.glAccountCode}`,
            );
        }
    }
}
