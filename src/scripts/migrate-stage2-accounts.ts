import sql from "mssql";
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import {
    glAccounts,
    accountMappings,
    settings,
    paymentMethods,
    users,
} from "../db/schemas";

const mssqlConfig: sql.config = {
    user: "api",
    password: "Hrd12345",
    server: "192.168.5.100",
    port: 1433,
    database: "dbPrimaNusantara",
    options: {
        encrypt: false,
        trustServerCertificate: true,
    },
};

type GlType = "asset" | "liability" | "equity" | "income" | "expense";

function determineAccountType(code: string, bs?: string, ist?: string): GlType {
    const firstDigit = code.trim().charAt(0);
    switch (firstDigit) {
        case "1":
            return "asset";
        case "2":
            return "liability";
        case "3":
            return "equity";
        case "4":
            return "income";
        case "5":
            return "expense";
        case "6":
            return "expense";
        case "7":
            // 7100 is other income, 7200 is other expense
            if (code.startsWith("7100")) return "income";
            if (code.startsWith("7200")) return "expense";
            return "income";
        default:
            return "asset";
    }
}

async function main() {
    console.log("=================================================");
    console.log("Starting Migration Stage 2: Chart of Accounts (COA)");
    console.log("Source: SQL Server dbPrimaNusantara (192.168.5.100)");
    console.log("Target: Grocy PostgreSQL Database");
    console.log("=================================================\n");

    const pool = await sql.connect(mssqlConfig);
    console.log("Connected to SQL Server successfully.\n");

    async function getOrCreateGlAccount(
        code: string,
        name: string,
        type: GlType,
        parentId: string | null = null,
    ) {
        const [existing] = await db
            .select()
            .from(glAccounts)
            .where(eq(glAccounts.code, code))
            .limit(1);

        if (existing) {
            // Update name / parentId if needed
            if (parentId && existing.parentId !== parentId) {
                await db
                    .update(glAccounts)
                    .set({ parentId, name, type })
                    .where(eq(glAccounts.id, existing.id));
            }
            return existing;
        }

        const [inserted] = await db
            .insert(glAccounts)
            .values({
                code,
                name,
                type,
                parentId,
                isActive: true,
            })
            .returning();
        return inserted;
    }

    const glMapByCode: Record<string, typeof glAccounts.$inferSelect> = {};

    // 1. Level 1 (MstAccountLv1)
    console.log("1. Migrating Account Level 1...");
    const lv1Src = await pool.request().query("SELECT AccountLv1, AccountLv1Name, BS, IST FROM MstAccountLv1");
    for (const row of lv1Src.recordset) {
        const code = row.AccountLv1.trim();
        const name = (row.AccountLv1Name || code).trim();
        const type = determineAccountType(code, row.BS, row.IST);
        const acc = await getOrCreateGlAccount(code, name, type, null);
        glMapByCode[code] = acc;
    }
    console.log(`   Migrated ${lv1Src.recordset.length} Level 1 accounts.`);

    // 2. Level 2 (MstAccountLv2)
    console.log("2. Migrating Account Level 2...");
    const lv2Src = await pool.request().query("SELECT AccountLv2, AccountLv1, AccountLv2Name FROM MstAccountLv2");
    for (const row of lv2Src.recordset) {
        const code = row.AccountLv2.trim();
        const parentCode = (row.AccountLv1 || "").trim();
        const name = (row.AccountLv2Name || code).trim();
        const type = determineAccountType(code);
        const parentId = glMapByCode[parentCode]?.id || null;
        const acc = await getOrCreateGlAccount(code, name, type, parentId);
        glMapByCode[code] = acc;
    }
    console.log(`   Migrated ${lv2Src.recordset.length} Level 2 accounts.`);

    // 3. Level 3 (MstAccountLv3)
    console.log("3. Migrating Account Level 3...");
    const lv3Src = await pool.request().query("SELECT AccountLv3, AccountLv2, AccountLv3Name FROM MstAccountLv3");
    for (const row of lv3Src.recordset) {
        const code = row.AccountLv3.trim();
        const parentCode = (row.AccountLv2 || "").trim();
        const name = (row.AccountLv3Name || code).trim();
        const type = determineAccountType(code);
        const parentId = glMapByCode[parentCode]?.id || null;
        const acc = await getOrCreateGlAccount(code, name, type, parentId);
        glMapByCode[code] = acc;
    }
    console.log(`   Migrated ${lv3Src.recordset.length} Level 3 accounts.`);

    // 4. Level 4 (MstAccountLv4)
    console.log("4. Migrating Account Level 4...");
    const lv4Src = await pool.request().query("SELECT AccountLv4, AccountLv3, AccountLv4Name FROM MstAccountLv4");
    for (const row of lv4Src.recordset) {
        const code = row.AccountLv4.trim();
        const parentCode = (row.AccountLv3 || "").trim();
        const name = (row.AccountLv4Name || code).trim();
        const type = determineAccountType(code);
        const parentId = glMapByCode[parentCode]?.id || null;
        const acc = await getOrCreateGlAccount(code, name, type, parentId);
        glMapByCode[code] = acc;
    }
    console.log(`   Migrated ${lv4Src.recordset.length} Level 4 accounts.`);

    // 5. Operational Accounts (MstAccount)
    console.log("5. Migrating Operational Accounts (MstAccount)...");
    const accSrc = await pool.request().query("SELECT AccAct, Descr, AccountLv4, Active FROM MstAccount");
    let operationalCount = 0;
    for (const row of accSrc.recordset) {
        const code = row.AccAct.trim();
        const parentCode = (row.AccountLv4 || "").trim();
        const name = (row.Descr || code).trim();
        const type = determineAccountType(code);
        const parentId = glMapByCode[parentCode]?.id || null;
        const acc = await getOrCreateGlAccount(code, name, type, parentId);
        glMapByCode[code] = acc;
        operationalCount++;
    }
    console.log(`   Migrated ${operationalCount} operational accounts.`);

    // 6. Update Account Mappings with real migrated codes
    console.log("6. Updating System Account Mappings...");
    const mappingsToSet: Array<{
        type: (typeof accountMappings.$inferSelect)["type"];
        side: NonNullable<(typeof accountMappings.$inferSelect)["side"]>;
        glAccountCode: string;
        note: string;
    }> = [
        { type: "purchase", side: "debit", glAccountCode: "1104.101", note: "PERSEDIAAN BARANG" },
        { type: "purchase", side: "credit", glAccountCode: "2102.101", note: "HUTANG DAGANG" },
        { type: "sales", side: "debit", glAccountCode: "1103.101", note: "PIUTANG DAGANG" },
        { type: "sales", side: "credit", glAccountCode: "4100.101", note: "PENJUALAN" },
        { type: "sales_tax", side: "credit", glAccountCode: "2105.107", note: "PPN KELUARAN" },
        { type: "purchase_tax", side: "debit", glAccountCode: "1104.101", note: "PPN MASUKAN" },
    ];

    for (const m of mappingsToSet) {
        const [existing] = await db
            .select()
            .from(accountMappings)
            .where(
                and(
                    eq(accountMappings.type, m.type),
                    eq(accountMappings.side, m.side),
                ),
            )
            .limit(1);

        if (!existing) {
            await db.insert(accountMappings).values({
                type: m.type,
                side: m.side,
                glAccountCode: m.glAccountCode,
                note: m.note,
            });
        } else {
            await db
                .update(accountMappings)
                .set({
                    glAccountCode: m.glAccountCode,
                    note: m.note,
                })
                .where(eq(accountMappings.id, existing.id));
        }
    }
    console.log("   Account mappings updated to use active business accounts.");

    // 7. Update Global Settings (Rounding diff & Retained earnings)
    console.log("7. Updating Global Settings (Rounding & Retained Earnings)...");
    const roundingAcc = glMapByCode["7100.104"] || glMapByCode["5300"];
    const retainedAcc = glMapByCode["3100.000"] || glMapByCode["3200"];

    if (roundingAcc || retainedAcc) {
        await db
            .update(settings)
            .set({
                ...(roundingAcc ? { roundingDifferenceGlAccountId: roundingAcc.id } : {}),
                ...(retainedAcc ? { retainedEarningsGlAccountId: retainedAcc.id } : {}),
            })
            .where(eq(settings.id, "global"));
        console.log("   Settings updated with migrated rounding & equity accounts.");
    }

    // 8. Update Payment Methods to use migrated Cash & Bank accounts
    console.log("8. Updating Payment Methods...");
    const kasKecil = glMapByCode["1101.101"];
    const bankNisp = glMapByCode["2101.101"] || glMapByCode["1101.202"];

    if (kasKecil) {
        await db
            .update(paymentMethods)
            .set({ glAccountId: kasKecil.id })
            .where(eq(paymentMethods.name, "Cash"));
    }
    if (bankNisp) {
        await db
            .update(paymentMethods)
            .set({ glAccountId: bankNisp.id })
            .where(eq(paymentMethods.name, "Bank Transfer"));
    }

    // Update super_admin cash account
    if (kasKecil) {
        await db
            .update(users)
            .set({ cashGlAccountId: kasKecil.id })
            .where(eq(users.username, "super_admin"));
    }
    console.log("   Payment methods & user accounts mapped to real Cash/Bank GL.");

    await pool.close();
    console.log("\n=================================================");
    console.log("Migration Stage 2 (COA & Mappings) Completed Successfully!");
    console.log("=================================================");
    process.exit(0);
}

main().catch((err) => {
    console.error("\n❌ Migration Stage 2 Failed:", err);
    process.exit(1);
});
