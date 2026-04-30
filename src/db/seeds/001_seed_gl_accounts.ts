import { db } from "@/db";
import { glAccounts } from "@/db/schemas";
import { eq } from "drizzle-orm";

type GlAccountSeedData = {
    code: string;
    name: string;
    type: "asset" | "liability" | "equity" | "income" | "expense";
    parentCode: string | null;
    isActive: boolean;
};

const glAccountsData: GlAccountSeedData[] = [
    {
        code: "1000",
        name: "Aset",
        type: "asset",
        parentCode: null,
        isActive: true,
    },
    {
        code: "1100",
        name: "Kas",
        type: "asset",
        parentCode: "1000",
        isActive: true,
    },
    {
        code: "1200",
        name: "Bank",
        type: "asset",
        parentCode: "1000",
        isActive: true,
    },
    {
        code: "1300",
        name: "Piutang Usaha",
        type: "asset",
        parentCode: "1000",
        isActive: true,
    },
    {
        code: "1400",
        name: "Persediaan",
        type: "asset",
        parentCode: "1000",
        isActive: true,
    },
    {
        code: "1500",
        name: "Pajak Dibayar di Muka",
        type: "asset",
        parentCode: "1000",
        isActive: true,
    },

    // Liabilities
    {
        code: "2000",
        name: "Kewajiban",
        type: "liability",
        parentCode: null,
        isActive: true,
    },
    {
        code: "2100",
        name: "Hutang Usaha",
        type: "liability",
        parentCode: "2000",
        isActive: true,
    },
    {
        code: "2200",
        name: "Hutang Pajak",
        type: "liability",
        parentCode: "2000",
        isActive: true,
    },

    // Equity
    {
        code: "3000",
        name: "Ekuitas",
        type: "equity",
        parentCode: null,
        isActive: true,
    },

    // Income
    {
        code: "4000",
        name: "Pendapatan",
        type: "income",
        parentCode: null,
        isActive: true,
    },
    {
        code: "4100",
        name: "Pendapatan Penjualan",
        type: "income",
        parentCode: "4000",
        isActive: true,
    },

    // Expenses
    {
        code: "5000",
        name: "Beban",
        type: "expense",
        parentCode: null,
        isActive: true,
    },
    {
        code: "5100",
        name: "Harga Pokok Penjualan (HPP)",
        type: "expense",
        parentCode: "5000",
        isActive: true,
    },
    {
        code: "5200",
        name: "Beban Operasional",
        type: "expense",
        parentCode: "5000",
        isActive: true,
    },
    {
        code: "5300",
        name: "Selisih Pembulatan",
        type: "expense",
        parentCode: "5000",
        isActive: true,
    },
];

export async function seedGlAccounts(dbInstance: typeof db) {
    for (const acc of glAccountsData) {
        const exists = await dbInstance
            .select()
            .from(glAccounts)
            .where(eq(glAccounts.code, acc.code))
            .limit(1);

        if (exists.length === 0) {
            let parentId = null;

            if (acc.parentCode) {
                const parent = await dbInstance
                    .select()
                    .from(glAccounts)
                    .where(eq(glAccounts.code, acc.parentCode))
                    .limit(1);

                if (parent.length > 0) {
                    parentId = parent[0].id;
                } else {
                    console.warn(
                        `Parent account ${acc.parentCode} not found for ${acc.code}`,
                    );
                }
            }

            await dbInstance.insert(glAccounts).values({
                code: acc.code,
                name: acc.name,
                type: acc.type,
                parentId: parentId,
                isActive: acc.isActive,
            });
            console.log(`Seeded gl account ${acc.code} - ${acc.name}`);
        } else {
            console.log(`Skipped ${acc.code}, already exists`);
        }
    }
}
