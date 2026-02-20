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
        name: "Assets",
        type: "asset",
        parentCode: null,
        isActive: true,
    },
    {
        code: "1100",
        name: "Cash",
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
        name: "Accounts Receivable",
        type: "asset",
        parentCode: "1000",
        isActive: true,
    },
    {
        code: "1400",
        name: "Inventory",
        type: "asset",
        parentCode: "1000",
        isActive: true,
    },

    // Liabilities
    {
        code: "2000",
        name: "Liabilities",
        type: "liability",
        parentCode: null,
        isActive: true,
    },
    {
        code: "2100",
        name: "Accounts Payable",
        type: "liability",
        parentCode: "2000",
        isActive: true,
    },

    // Equity
    {
        code: "3000",
        name: "Equity",
        type: "equity",
        parentCode: null,
        isActive: true,
    },

    // Income
    {
        code: "4000",
        name: "Income",
        type: "income",
        parentCode: null,
        isActive: true,
    },
    {
        code: "4100",
        name: "Sales Revenue",
        type: "income",
        parentCode: "4000",
        isActive: true,
    },

    // Expenses
    {
        code: "5000",
        name: "Expenses",
        type: "expense",
        parentCode: null,
        isActive: true,
    },
    {
        code: "5100",
        name: "Cost of Goods Sold",
        type: "expense",
        parentCode: "5000",
        isActive: true,
    },
    {
        code: "5200",
        name: "Operating Expenses",
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
