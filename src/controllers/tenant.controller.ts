import { Request, Response } from "express";
import {
    listAvailableDatabases,
    checkDatabaseExists,
    provisionWorkspace,
    sanitizeDatabaseName,
    getDefaultDatabaseName,
    getTenantDb,
    syncTenantPermissions,
    ensureEssentialTenantData,
    verifySetupToken,
    getTenantSubscriptionStatus,
} from "@/services/tenant.service";

export async function getDatabasesHandler(_req: Request, res: Response) {
    try {
        const databases = await listAvailableDatabases();
        res.json({
            databases,
            defaultDatabase: getDefaultDatabaseName(),
        });
    } catch (err: any) {
        res.status(500).json({
            message: "Gagal mengambil daftar database",
            error: err.message,
        });
    }
}

export async function checkDatabaseHandler(req: Request, res: Response) {
    try {
        const name = req.query.name as string;
        if (!name) {
            res.status(400).json({ message: "Parameter 'name' wajib disertakan" });
            return;
        }

        const clean = sanitizeDatabaseName(name);
        if (clean.length < 3) {
            res.json({
                valid: false,
                available: false,
                name: clean,
                message: "Nama database minimal 3 karakter (huruf, angka, underscore)",
            });
            return;
        }

        const exists = await checkDatabaseExists(clean);
        res.json({
            valid: true,
            available: !exists,
            name: clean,
            message: exists
                ? "Nama database sudah digunakan di server"
                : "Nama database tersedia",
        });
    } catch (err: any) {
        res.status(500).json({
            message: "Gagal memeriksa database",
            error: err.message,
        });
    }
}

export async function verifyTokenHandler(req: Request, res: Response) {
    try {
        const token = (req.query.token as string) || "";
        const result = await verifySetupToken(token);
        if (result.valid) {
            res.json({
                valid: true,
                message: "Setup token valid",
                token: result.token,
            });
        } else {
            res.status(400).json({
                valid: false,
                message: result.error || "Token tidak valid",
            });
        }
    } catch (err: any) {
        res.status(500).json({
            valid: false,
            message: "Gagal memverifikasi token",
            error: err.message,
        });
    }
}

export async function createWorkspaceHandler(req: Request, res: Response) {
    try {
        const {
            databaseName,
            branch,
            superAdmin,
            useDefaultSeed,
            customData,
            setupToken,
        } = req.body;

        if (
            !databaseName ||
            !branch?.name ||
            !superAdmin?.username ||
            !superAdmin?.password ||
            !setupToken
        ) {
            res.status(400).json({
                message:
                    "Data tidak lengkap: nama database, nama cabang, username, password, dan setup token otorisasi wajib diisi.",
            });
            return;
        }

        const cleanDbName = sanitizeDatabaseName(databaseName);
        const exists = await checkDatabaseExists(cleanDbName);
        if (exists) {
            res.status(400).json({
                message: `Database '${cleanDbName}' sudah ada. Silakan gunakan nama lain.`,
            });
            return;
        }

        const result = await provisionWorkspace({
            databaseName: cleanDbName,
            setupToken: setupToken.trim(),
            branch: {
                name: branch.name,
                address: branch.address,
                phone: branch.phone,
            },
            superAdmin: {
                name: superAdmin.name || "Super Administrator",
                username: superAdmin.username,
                password: superAdmin.password,
            },
            useDefaultSeed: useDefaultSeed ?? true,
            customData,
        });

        res.status(201).json({
            message: "Workspace dan database baru berhasil dibuat!",
            data: result,
        });
    } catch (err: any) {
        res.status(500).json({
            message: "Gagal membuat workspace baru",
            error: err.message,
        });
    }
}

export async function getCurrentTenantHandler(req: Request, res: Response) {
    res.json({
        databaseName: req.databaseName || getDefaultDatabaseName(),
    });
}

export async function syncPermissionsHandler(req: Request, res: Response) {
    try {
        const targetDbName = req.body?.databaseName || req.databaseName || getDefaultDatabaseName();
        const tenantDb = getTenantDb(targetDbName);
        await syncTenantPermissions(tenantDb);
        await ensureEssentialTenantData(tenantDb);
        res.json({
            success: true,
            message: `Permissions & essential master data synced successfully for database: ${targetDbName}`,
        });
    } catch (err: any) {
        res.status(500).json({
            message: "Gagal sinkronisasi permission database",
            error: err.message,
        });
    }
}

export async function getTenantSubscriptionHandler(req: Request, res: Response) {
    try {
        const dbName = (req.query.database as string) || req.databaseName || getDefaultDatabaseName();
        const sub = await getTenantSubscriptionStatus(dbName);
        res.json(sub);
    } catch (err: any) {
        res.status(500).json({
            message: "Gagal membaca status subscription tenant",
            error: err.message,
        });
    }
}
