import { AsyncLocalStorage } from "node:async_hooks";
import { Pool } from "pg";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schemas";
import { exec } from "child_process";
import path from "path";
import fs from "fs";
import bcrypt from "bcrypt";
import { eq, and } from "drizzle-orm";
import { seedGlAccounts } from "@/db/seeds/001_seed_gl_accounts";
import { seedAccountMappings } from "@/db/seeds/002_seed_account_mappings";
import { seedSettings } from "@/db/seeds/006_seed_settings";
import {
    PERMISSION_GROUPS,
    ALL_PERMISSIONS,
} from "@/constants/permissions.constant";

export interface TenantContext {
    dbName: string;
    db: NodePgDatabase<typeof schema>;
}

export const tenantStorage = new AsyncLocalStorage<TenantContext>();

// In-memory pool cache
const poolCache = new Map<
    string,
    { pool: Pool; db: NodePgDatabase<typeof schema> }
>();

// Parse Base Database URL (without the database name)
function getBaseDbConfig() {
    const defaultUrl = process.env.DB_URL;
    if (!defaultUrl) {
        throw new Error("DB_URL is not defined in environment");
    }
    const lastSlashIndex = defaultUrl.lastIndexOf("/");
    const baseUrl = defaultUrl.substring(0, lastSlashIndex + 1);
    const defaultDbName = defaultUrl
        .substring(lastSlashIndex + 1)
        .split("?")[0];
    const queryParams = defaultUrl.includes("?")
        ? "?" + defaultUrl.split("?")[1]
        : "";

    return { baseUrl, defaultDbName, queryParams, defaultUrl };
}

export function getDefaultDatabaseName(): string {
    return getBaseDbConfig().defaultDbName;
}

export function buildDatabaseUrl(dbName: string): string {
    const { baseUrl, queryParams } = getBaseDbConfig();
    return `${baseUrl}${dbName}${queryParams}`;
}

export function sanitizeDatabaseName(name: string): string {
    return name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9_]/g, "_")
        .slice(0, 32);
}

// Master pool connecting to maintenance DB (postgres or default db)
let masterPool: Pool | null = null;
function getMasterPool(): Pool {
    if (!masterPool) {
        const { defaultUrl } = getBaseDbConfig();
        masterPool = new Pool({ connectionString: defaultUrl });
    }
    return masterPool;
}

/**
 * Close and evict a specific tenant connection pool
 */
export async function closeTenantPool(dbName: string): Promise<void> {
    const cleanName = sanitizeDatabaseName(dbName);
    if (poolCache.has(cleanName)) {
        const item = poolCache.get(cleanName);
        poolCache.delete(cleanName);
        if (item?.pool) {
            try {
                await item.pool.end();
            } catch {}
        }
    }
}

/**
 * Graceful shutdown: close all tenant pools and master pool
 */
export async function closeAllTenantPools(): Promise<void> {
    for (const [name, item] of poolCache.entries()) {
        try {
            await item.pool.end();
        } catch {}
    }
    poolCache.clear();
    if (masterPool) {
        try {
            await masterPool.end();
        } catch {}
        masterPool = null;
    }
}

/**
 * Get or create Drizzle DB instance for a given database name
 */
export function getTenantDb(dbName?: string): NodePgDatabase<typeof schema> {
    const store = tenantStorage.getStore();
    // Fast-path: if current async context already has the requested tenant db, return it directly
    if (store?.db && (!dbName || sanitizeDatabaseName(dbName) === store.dbName)) {
        return store.db;
    }

    const targetName = dbName
        ? sanitizeDatabaseName(dbName)
        : store?.dbName || getDefaultDatabaseName();

    if (poolCache.has(targetName)) {
        return poolCache.get(targetName)!.db;
    }

    const connUrl = buildDatabaseUrl(targetName);
    const pool = new Pool({
        connectionString: connUrl,
        max: 8,
        min: 0,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 5000,
    });

    const dbInstance = drizzle(pool, { schema });
    poolCache.set(targetName, { pool, db: dbInstance });

    return dbInstance;
}

/**
 * List all user/tenant databases in PostgreSQL
 */
export async function listAvailableDatabases(): Promise<string[]> {
    const pool = getMasterPool();
    const result = await pool.query<{ datname: string }>(
        `SELECT datname FROM pg_database 
         WHERE datistemplate = false 
           AND datname NOT IN ('postgres', 'information_schema') 
         ORDER BY datname ASC`,
    );

    return result.rows.map((r) => r.datname);
}

/**
 * Check if a database already exists
 */
export async function checkDatabaseExists(dbName: string): Promise<boolean> {
    const cleanName = sanitizeDatabaseName(dbName);
    const pool = getMasterPool();
    const result = await pool.query(
        "SELECT 1 FROM pg_database WHERE datname = $1",
        [cleanName],
    );
    return (result.rowCount ?? 0) > 0;
}

/**
 * Create a new PostgreSQL database
 */
export async function createDatabase(dbName: string): Promise<void> {
    const cleanName = sanitizeDatabaseName(dbName);
    if (!cleanName || cleanName.length < 3) {
        throw new Error("Nama database minimal 3 karakter (a-z, 0-9, _)");
    }

    const exists = await checkDatabaseExists(cleanName);
    if (exists) {
        throw new Error(`Database '${cleanName}' sudah ada.`);
    }

    const pool = getMasterPool();
    // Identifiers in CREATE DATABASE cannot use bind params, but cleanName is strictly sanitized
    await pool.query(`CREATE DATABASE "${cleanName}" WITH ENCODING = 'UTF8';`);
}

/**
 * Drop a database and disconnect all active connections (used for rollback/cleanup)
 */
export async function dropDatabase(dbName: string): Promise<void> {
    const cleanName = sanitizeDatabaseName(dbName);
    const pool = getMasterPool();

    // Close any cached pg connection pool for this tenant
    await closeTenantPool(cleanName);

    // Terminate existing background backend connections to this database
    await pool.query(
        `SELECT pg_terminate_backend(pid) 
         FROM pg_stat_activity 
         WHERE datname = $1 AND pid <> pg_backend_pid();`,
        [cleanName],
    );

    // Identifiers in DROP DATABASE cannot use bind params, but cleanName is strictly sanitized
    await pool.query(`DROP DATABASE IF EXISTS "${cleanName}";`);
}

/**
 * Push Drizzle schema to a database asynchronously without blocking Node event loop
 */
export async function applySchemaToDatabase(dbName: string): Promise<void> {
    const cleanName = sanitizeDatabaseName(dbName);
    const targetUrl = buildDatabaseUrl(cleanName);
    const serverDir = path.resolve(__dirname, "../../");

    return new Promise((resolve, reject) => {
        exec(
            "npx drizzle-kit push --force",
            {
                cwd: serverDir,
                env: {
                    ...process.env,
                    DB_URL: targetUrl,
                },
            },
            (err, _stdout, stderr) => {
                if (err) {
                    const errorMsg = stderr ? stderr.toString() : err.message;
                    return reject(
                        new Error(`Gagal menerapkan skema tabel: ${errorMsg}`),
                    );
                }
                resolve();
            },
        );
    });
}

export interface WorkspaceProvisionParams {
    databaseName: string;
    setupToken: string;
    branch: {
        name: string;
        address?: string;
        phone?: string;
    };
    superAdmin: {
        name: string;
        username: string;
        password: string;
    };
    useDefaultSeed?: boolean;
    customData?: {
        warehouseName?: string;
        priceGroupName?: string;
        customerName?: string;
        supplierName?: string;
    };
}

export interface TokenVerificationResult {
    valid: boolean;
    error?: string;
    token?: {
        token: string;
        clientName: string;
        maxUsage: number;
        usedCount: number;
        expiresAt: string | null;
        status: string;
    };
}

const getMonitorUrl = () =>
    process.env.MONITOR_URL ||
    process.env.GROCY_MONITOR_URL ||
    "http://127.0.0.1:3003";

function getCandidateTokenPaths(): string[] {
    const list: (string | undefined)[] = [
        process.env.MONITOR_TOKENS_PATH,
        process.env.GROCY_MONITOR_TOKENS_PATH,
        "C:/Users/admin/Documents/grocy-monitor/data/tokens.json",
        path.resolve(process.cwd(), "../grocy-monitor/data/tokens.json"),
        path.resolve(__dirname, "../../../grocy-monitor/data/tokens.json"),
        "d:/Development/grocy-monitor/data/tokens.json",
    ];
    return list.filter((p): p is string => Boolean(p));
}

export async function verifySetupToken(
    tokenCode: string,
): Promise<TokenVerificationResult> {
    if (!tokenCode || !tokenCode.trim()) {
        return {
            valid: false,
            error: "Setup Authorization Token tidak boleh kosong",
        };
    }

    const cleanCode = tokenCode.trim().toUpperCase();

    // 1. Try grocy-monitor API first
    try {
        const monitorUrl = getMonitorUrl();
        const res = await fetch(
            `${monitorUrl}/api/tokens/verify?token=${encodeURIComponent(cleanCode)}`,
            {
                signal: AbortSignal.timeout(1500),
            },
        );
        const data = (await res.json()) as any;
        if (data && typeof data.valid === "boolean") {
            return data;
        }
        if (!res.ok) {
            return {
                valid: false,
                error: data?.error || "Token otorisasi setup database tidak valid",
            };
        }
    } catch {}

    // 2. Direct file fallback
    try {
        const candidates = getCandidateTokenPaths();

        const tokensFile = candidates.find((p) => fs.existsSync(p));
        if (tokensFile) {
            const raw = fs.readFileSync(tokensFile, "utf8");
            const tokens = JSON.parse(raw || "[]");
            const found = tokens.find(
                (t: any) => t.token?.toUpperCase() === cleanCode,
            );
            if (!found) {
                return {
                    valid: false,
                    error: "Token tidak ditemukan di sistem",
                };
            }
            if (found.status === "revoked") {
                return {
                    valid: false,
                    error: "Token telah dinonaktifkan oleh Administrator",
                };
            }
            if (found.expiresAt && new Date(found.expiresAt) < new Date()) {
                return { valid: false, error: "Token telah kadaluarsa" };
            }
            if (found.maxUsage && found.usedCount >= found.maxUsage) {
                return {
                    valid: false,
                    error: "Batas pemakaian token ini telah habis",
                };
            }
            return { valid: true, token: found };
        }
    } catch (e: any) {
        return {
            valid: false,
            error: "Gagal memverifikasi token: " + e.message,
        };
    }

    return {
        valid: false,
        error: "Token otorisasi setup database tidak valid",
    };
}

export async function consumeSetupToken(
    tokenCode: string,
    databaseName: string,
): Promise<{ ok: boolean; error?: string }> {
    const cleanCode = tokenCode.trim().toUpperCase();

    // 1. Try grocy-monitor API
    try {
        const monitorUrl = getMonitorUrl();
        const res = await fetch(`${monitorUrl}/api/tokens/consume`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: cleanCode, databaseName }),
            signal: AbortSignal.timeout(1500),
        });
        const data = (await res.json()) as any;
        if (!res.ok) {
            return {
                ok: false,
                error: data?.error || "Token ditolak oleh sistem otorisasi",
            };
        }
        return { ok: true };
    } catch {}

    // 2. Direct file fallback
    try {
        const candidates = getCandidateTokenPaths();

        const tokensFile = candidates.find((p) => fs.existsSync(p));
        if (tokensFile) {
            const tokens = JSON.parse(
                fs.readFileSync(tokensFile, "utf8") || "[]",
            );
            const idx = tokens.findIndex(
                (t: any) => t.token?.toUpperCase() === cleanCode,
            );
            if (idx === -1)
                return { ok: false, error: "Token tidak ditemukan di sistem" };
            const t = tokens[idx];
            if (t.status === "revoked")
                return { ok: false, error: "Token telah dinonaktifkan" };
            if (t.expiresAt && new Date(t.expiresAt) < new Date())
                return { ok: false, error: "Token telah kadaluarsa" };
            if (t.maxUsage && t.usedCount >= t.maxUsage)
                return {
                    ok: false,
                    error: "Batas pemakaian token telah habis",
                };

            t.usedCount = (t.usedCount || 0) + 1;
            if (!t.usages) t.usages = [];
            t.usages.push({
                databaseName,
                usedAt: new Date().toISOString(),
                ip: "grocy-server",
            });
            if (t.usedCount >= t.maxUsage && t.maxUsage < 900) {
                t.status = "used";
            }
            fs.writeFileSync(tokensFile, JSON.stringify(tokens, null, 2));
            return { ok: true };
        }
    } catch (e: any) {
        return { ok: false, error: e.message };
    }

    return { ok: false, error: "Gagal memproses token setup" };
}

/**
 * Complete Workspace Provisioning:
 * 0. Verifies & consumes setup authorization token
 * 1. Creates database
 * 2. Applies Drizzle schema
 * 3. Creates HQ branch
 * 4. Seeds roles and permissions
 * 5. Creates super_admin user
 * 6. Seeds master data (default template or custom)
 */
export async function provisionWorkspace(params: WorkspaceProvisionParams) {
    const dbName = sanitizeDatabaseName(params.databaseName);

    // 0. Phase 1: Verify token validity without consuming yet
    if (!params.setupToken) {
        throw new Error(
            "Setup Authorization Token wajib disertakan untuk membuat database baru.",
        );
    }
    const verification = await verifySetupToken(params.setupToken);
    if (!verification.valid) {
        throw new Error(
            verification.error ||
                "Token otorisasi setup tidak valid atau sudah kadaluarsa.",
        );
    }

    let dbCreated = false;

    try {
        // 1. Create DB
        await createDatabase(dbName);
        dbCreated = true;

        // 2. Apply Schema asynchronously
        await applySchemaToDatabase(dbName);

        // 3. Connect to new DB
        const tenantDb = getTenantDb(dbName);

        // 4. Create HQ Branch
        const [hqBranch] = await tenantDb
            .insert(schema.branches)
            .values({
                code: "HQ",
                name: params.branch.name || "Kantor Pusat HQ",
                address: params.branch.address || "",
                phone: params.branch.phone || "",
                isHq: true,
                isActive: true,
            })
            .returning();

        // 5. Ensure Standard Roles
        const standardRoles = [
            "super_admin",
            "admin",
            "cashier",
            "warehouse",
            "accountant",
            "user",
        ];
        const roleMap: Record<string, string> = {};

        for (const rName of standardRoles) {
            const [r] = await tenantDb
                .insert(schema.roles)
                .values({ name: rName })
                .returning();
            roleMap[rName] = r.id;
        }

        // 6. Seed Permissions & Assign to super_admin (fast batch)
        await syncTenantPermissions(tenantDb, roleMap["super_admin"]);

        // 7. Create Primary Warehouse (BEFORE user creation so user can be assigned to it)
        const primaryWarehouseName =
            params.useDefaultSeed !== false
                ? "Gudang Utama HQ"
                : params.customData?.warehouseName?.trim() || "Gudang Utama HQ";

        const [mainWarehouse] = await tenantDb
            .insert(schema.warehouses)
            .values({
                branchId: hqBranch.id,
                name: primaryWarehouseName,
                address: params.branch.address || "Area Kantor Pusat",
                isActive: true,
            })
            .returning();

        // 8. Ensure Essential Foundation Data (GL Accounts, Account Mappings, Settings, Taxes, Return Reasons, Product Attributes)
        await ensureEssentialTenantData(tenantDb);

        // Resolve Cash & Bank GL Accounts
        const [cashGl] = await tenantDb
            .select()
            .from(schema.glAccounts)
            .where(eq(schema.glAccounts.code, "1100"))
            .limit(1);

        const [bankGl] = await tenantDb
            .select()
            .from(schema.glAccounts)
            .where(eq(schema.glAccounts.code, "1200"))
            .limit(1);

        // 9. Create Super Admin User (Linked with posWarehouseId & cashGlAccountId)
        const hashedPassword = await bcrypt.hash(params.superAdmin.password, 10);
        const [adminUser] = await tenantDb
            .insert(schema.users)
            .values({
                username: params.superAdmin.username.toLowerCase().trim(),
                displayName: params.superAdmin.name || "Super Admin",
                password: hashedPassword,
                roleId: roleMap["super_admin"],
                branchId: hqBranch.id,
                posWarehouseId: mainWarehouse.id,
                cashGlAccountId: cashGl?.id || null,
                isActive: true,
            })
            .returning();

        // 10. Operational Seeds (Units, Price Groups, Payment Methods, Contacts)
        if (params.useDefaultSeed !== false) {
            // Standard Units
            const units = [
                { name: "Pcs", abbreviation: "pcs" },
                { name: "Box", abbreviation: "box" },
                { name: "Dus", abbreviation: "dus" },
                { name: "Pack", abbreviation: "pack" },
                { name: "Kilogram", abbreviation: "kg" },
                { name: "Liter", abbreviation: "ltr" },
            ];
            for (const u of units) {
                await tenantDb.insert(schema.productUnits).values(u);
            }

            // Standard Price Groups
            const [pgRegular] = await tenantDb
                .insert(schema.priceGroups)
                .values({
                    name: "Regular / Umum",
                    description: "Harga Standar",
                    isActive: true,
                })
                .returning();
            await tenantDb.insert(schema.priceGroups).values([
                { name: "Grosir", description: "Harga Grosir", isActive: true },
                {
                    name: "Member Silver",
                    description: "Tier Silver",
                    isActive: true,
                },
                { name: "Member Gold", description: "Tier Gold", isActive: true },
            ]);

            // Standard Payment Methods (linked with GL accounts)
            await tenantDb.insert(schema.paymentMethods).values([
                {
                    name: "Kas Tunai",
                    color: "#16a34a",
                    icon: "Banknote",
                    isCash: true,
                    glAccountId: cashGl?.id || null,
                },
                {
                    name: "Transfer Bank BCA",
                    color: "#2563eb",
                    icon: "CreditCard",
                    isCash: false,
                    glAccountId: bankGl?.id || null,
                },
                {
                    name: "Transfer Bank Mandiri",
                    color: "#0284c7",
                    icon: "CreditCard",
                    isCash: false,
                    glAccountId: bankGl?.id || null,
                },
                {
                    name: "QRIS",
                    color: "#9333ea",
                    icon: "QrCode",
                    isCash: false,
                    glAccountId: bankGl?.id || null,
                },
            ]);

            // Standard Customer & Supplier
            await tenantDb.insert(schema.contacts).values([
                {
                    name: "Pelanggan Umum",
                    contactType: "customer",
                    priceGroupId: pgRegular.id,
                    address: "-",
                    phone: "-",
                    email: "-",
                    isActive: true,
                },
                {
                    name: "Pemasok Utama",
                    contactType: "supplier",
                    address: "-",
                    phone: "-",
                    email: "-",
                    isActive: true,
                },
            ]);
        } else {
            // Custom minimal data
            const customUnits = [
                { name: "Pcs", abbreviation: "pcs" },
                { name: "Box", abbreviation: "box" },
                { name: "Dus", abbreviation: "dus" },
            ];
            for (const u of customUnits) {
                await tenantDb.insert(schema.productUnits).values(u);
            }

            // Price Group
            const [pgCustom] = await tenantDb
                .insert(schema.priceGroups)
                .values({
                    name: params.customData?.priceGroupName?.trim() || "Regular / Umum",
                    description: "Kelompok Harga Awal",
                    isActive: true,
                })
                .returning();

            // Payment Methods (linked with GL accounts)
            await tenantDb.insert(schema.paymentMethods).values([
                {
                    name: "Kas Tunai",
                    color: "#16a34a",
                    icon: "Banknote",
                    isCash: true,
                    glAccountId: cashGl?.id || null,
                },
                {
                    name: "Transfer Bank",
                    color: "#2563eb",
                    icon: "CreditCard",
                    isCash: false,
                    glAccountId: bankGl?.id || null,
                },
            ]);

            // Contacts
            await tenantDb.insert(schema.contacts).values([
                {
                    name: params.customData?.customerName?.trim() || "Pelanggan Umum",
                    contactType: "customer",
                    priceGroupId: pgCustom.id,
                    address: "-",
                    phone: "-",
                    email: "-",
                    isActive: true,
                },
                {
                    name: params.customData?.supplierName?.trim() || "Pemasok Utama",
                    contactType: "supplier",
                    address: "-",
                    phone: "-",
                    email: "-",
                    isActive: true,
                },
            ]);
        }

        // Phase 2: Consume Token ONLY AFTER successful provisioning
        const tokenResult = await consumeSetupToken(params.setupToken, dbName);
        if (!tokenResult.ok) {
            console.warn(
                `Warning: Workspace provisioned for ${dbName} but token consume reported: ${tokenResult.error}`,
            );
        }

        return {
            databaseName: dbName,
            branch: hqBranch,
            superAdmin: {
                id: adminUser.id,
                displayName: adminUser.displayName,
                username: adminUser.username,
            },
        };
    } catch (err: any) {
        // Rollback: drop database if it was created but failed midway
        if (dbCreated) {
            try {
                await dropDatabase(dbName);
            } catch (cleanupErr) {
                console.error(`Rollback failed to drop database ${dbName}:`, cleanupErr);
            }
        }
        throw err;
    }
}

/**
 * Ensures all standard permission groups, all permissions, and super_admin role permissions exist
 */
export async function syncTenantPermissions(
    tenantDb: NodePgDatabase<typeof schema>,
    explicitSuperAdminRoleId?: string,
) {
    // 1. Ensure Groups Exist
    const existingGroups = await tenantDb
        .select()
        .from(schema.permissionGroups);
    const groupMap: Record<string, string> = {};
    for (const eg of existingGroups) {
        groupMap[eg.name] = eg.id;
    }

    const missingGroups = PERMISSION_GROUPS.filter((g) => !groupMap[g.name]);
    if (missingGroups.length > 0) {
        const insertedGroups = await tenantDb
            .insert(schema.permissionGroups)
            .values(missingGroups.map((g) => ({ name: g.name })))
            .returning();
        for (const ig of insertedGroups) {
            groupMap[ig.name] = ig.id;
        }
    }

    // Map group code to its ID
    const groupCodeToId: Record<string, string> = {};
    for (const g of PERMISSION_GROUPS) {
        if (groupMap[g.name]) {
            groupCodeToId[g.code] = groupMap[g.name];
        }
    }

    // 2. Ensure Permissions Exist
    const existingPerms = await tenantDb.select().from(schema.permissions);
    const permMap = new Map<string, typeof schema.permissions.$inferSelect>();
    for (const ep of existingPerms) {
        permMap.set(ep.code, ep);
    }

    const allPermsList: (typeof schema.permissions.$inferSelect)[] = [
        ...existingPerms,
    ];

    const fallbackGroupId =
        existingGroups[0]?.id || Object.values(groupMap)[0];
    const missingPerms = ALL_PERMISSIONS.filter(
        (p) => !permMap.has(p.code),
    ).map((p) => ({
        code: p.code,
        description: p.description,
        groupId: groupCodeToId[p.group] || fallbackGroupId,
    }));

    if (missingPerms.length > 0) {
        const insertedPerms = await tenantDb
            .insert(schema.permissions)
            .values(missingPerms)
            .returning();
        for (const ip of insertedPerms) {
            permMap.set(ip.code, ip);
            allPermsList.push(ip);
        }
    }

    // 3. Find or ensure super_admin role
    let superAdminRoleId = explicitSuperAdminRoleId;
    if (!superAdminRoleId) {
        const [superAdminRole] = await tenantDb
            .select()
            .from(schema.roles)
            .where(eq(schema.roles.name, "super_admin"))
            .limit(1);
        if (superAdminRole) {
            superAdminRoleId = superAdminRole.id;
        } else {
            const [createdRole] = await tenantDb
                .insert(schema.roles)
                .values({ name: "super_admin" })
                .returning();
            superAdminRoleId = createdRole.id;
        }
    }

    // 4. Assign ALL permissions to super_admin via fast batch insert
    const existingRolePerms = await tenantDb
        .select()
        .from(schema.rolePermissions)
        .where(eq(schema.rolePermissions.roleId, superAdminRoleId));

    const assignedPermIds = new Set(
        existingRolePerms.map((rp) => rp.permissionId),
    );

    const missingRolePerms = allPermsList
        .filter((perm) => !assignedPermIds.has(perm.id))
        .map((perm) => ({
            roleId: superAdminRoleId,
            permissionId: perm.id,
            hasPermission: true,
        }));

    if (missingRolePerms.length > 0) {
        const chunkSize = 200;
        for (let i = 0; i < missingRolePerms.length; i += chunkSize) {
            const chunk = missingRolePerms.slice(i, i + chunkSize);
            await tenantDb.insert(schema.rolePermissions).values(chunk);
        }
    }
}

/**
 * Ensures all essential master data exists in any tenant database:
 * 1. Chart of Accounts (23 standard GL accounts)
 * 2. Account Mappings (6 standard mappings: purchase, sales, tax)
 * 3. Settings (with linked rounding & retained earnings GL accounts)
 * 4. Taxes (PPN 11%)
 * 5. Return Reasons (DMG, WRG, EXP)
 * 6. Product Attributes (Category enum)
 * 7. Payment Methods with linked GL accounts
 * 8. User links to primary warehouse and cash GL account
 */
export async function ensureEssentialTenantData(
    tenantDb: NodePgDatabase<typeof schema>,
) {
    // 1. Seed GL Accounts
    await seedGlAccounts(tenantDb);

    // 2. Seed Account Mappings
    await seedAccountMappings(tenantDb);

    // 3. Seed Settings (with resolved GL IDs)
    await seedSettings(tenantDb);

    // 4. Ensure Default Tax (PPN 11%)
    const existingTaxes = await tenantDb.select().from(schema.taxes).limit(1);
    if (existingTaxes.length === 0) {
        await tenantDb.insert(schema.taxes).values({
            name: "PPN 11%",
            rate: 11,
        });
    }

    // 5. Ensure Standard Return Reasons
    const existingReasons = await tenantDb.select().from(schema.returnReasons);
    const reasonCodes = new Set(existingReasons.map((r) => r.code));
    const defaultReasons = [
        {
            name: "Barang Rusak / Cacat",
            code: "DMG",
            type: "all" as const,
            description: "Barang rusak, bocor, atau kemasan cacat fisik",
            isActive: true,
        },
        {
            name: "Salah Kirim Barang",
            code: "WRG",
            type: "all" as const,
            description: "Barang tidak sesuai dengan pesanan / invoice",
            isActive: true,
        },
        {
            name: "Kadaluarsa / Expired",
            code: "EXP",
            type: "all" as const,
            description: "Masa berlaku produk telah habis / mendekati expired",
            isActive: true,
        },
    ];
    for (const r of defaultReasons) {
        if (!reasonCodes.has(r.code)) {
            await tenantDb.insert(schema.returnReasons).values(r);
        }
    }

    // 6. Ensure Product Attributes (Category)
    const existingCategoryAttr = await tenantDb
        .select()
        .from(schema.productAttributes)
        .where(eq(schema.productAttributes.name, "Category"))
        .limit(1);
    if (existingCategoryAttr.length === 0) {
        await tenantDb.insert(schema.productAttributes).values({
            name: "Category",
            label: "category",
            type: "enum",
            options: [
                "default category",
                "Minuman",
                "Makanan Ringan",
                "Susu & Olahan",
                "Kopi & Teh",
                "Sembako",
                "Perawatan Diri",
            ],
        });
    }

    // 7. Resolve Cash (1100) and Bank (1200) GL accounts
    const [cashGl] = await tenantDb
        .select()
        .from(schema.glAccounts)
        .where(eq(schema.glAccounts.code, "1100"))
        .limit(1);

    const [bankGl] = await tenantDb
        .select()
        .from(schema.glAccounts)
        .where(eq(schema.glAccounts.code, "1200"))
        .limit(1);

    // 8. Link Payment Methods to GL accounts
    if (cashGl) {
        const cashMethods = await tenantDb
            .select()
            .from(schema.paymentMethods)
            .where(eq(schema.paymentMethods.isCash, true));
        for (const cm of cashMethods) {
            if (!cm.glAccountId) {
                await tenantDb
                    .update(schema.paymentMethods)
                    .set({ glAccountId: cashGl.id })
                    .where(eq(schema.paymentMethods.id, cm.id));
            }
        }
    }
    if (bankGl) {
        const nonCashMethods = await tenantDb
            .select()
            .from(schema.paymentMethods)
            .where(eq(schema.paymentMethods.isCash, false));
        for (const ncm of nonCashMethods) {
            if (!ncm.glAccountId) {
                await tenantDb
                    .update(schema.paymentMethods)
                    .set({ glAccountId: bankGl.id })
                    .where(eq(schema.paymentMethods.id, ncm.id));
            }
        }
    }

    // 9. Ensure Super Admin / User links to Warehouse and Cash GL
    const [mainWarehouse] = await tenantDb
        .select()
        .from(schema.warehouses)
        .limit(1);

    if (mainWarehouse && cashGl) {
        const usersToUpdate = await tenantDb.select().from(schema.users);
        for (const u of usersToUpdate) {
            const updates: Record<string, any> = {};
            if (!u.posWarehouseId) updates.posWarehouseId = mainWarehouse.id;
            if (!u.cashGlAccountId) updates.cashGlAccountId = cashGl.id;
            if (Object.keys(updates).length > 0) {
                await tenantDb
                    .update(schema.users)
                    .set(updates)
                    .where(eq(schema.users.id, u.id));
            }
        }
    }
}
