import { Request, Response, NextFunction } from "express";
import {
    tenantStorage,
    getTenantDb,
    getDefaultDatabaseName,
    sanitizeDatabaseName,
    getTenantSubscriptionStatus,
} from "@/services/tenant.service";

declare global {
    namespace Express {
        interface Request {
            databaseName?: string;
        }
    }
}

export async function tenantMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
) {
    // Read from header, query param, or fallback to default
    const headerDb = req.headers["x-database-name"] as string | undefined;
    const queryDb = req.query?.database as string | undefined;
    const sessionDb = (req.session as any)?.databaseName as string | undefined;

    const rawDbName = headerDb || queryDb || sessionDb || getDefaultDatabaseName();
    const cleanDbName = sanitizeDatabaseName(rawDbName);

    // Subscription Expiration Guard for Tenant Databases
    if (cleanDbName !== getDefaultDatabaseName()) {
        const exemptPrefixes = [
            "/healthz",
            "/api/tenant/databases",
            "/api/tenant/check-name",
            "/api/tenant/verify-token",
            "/api/tenant/create-workspace",
            "/api/tenant/subscription",
        ];
        const isExempt = exemptPrefixes.some(
            (p) => req.path?.startsWith(p) || req.originalUrl?.startsWith(p),
        );

        if (!isExempt) {
            try {
                const sub = await getTenantSubscriptionStatus(cleanDbName);
                if (sub.isExpired) {
                    return res.status(403).json({
                        code: "TENANT_EXPIRED",
                        message:
                            "Masa aktif trial / berlangganan database ini telah berakhir. Silakan hubungi Administrator untuk memperpanjang akses.",
                        database: cleanDbName,
                        clientName: sub.clientName,
                        expiresAt: sub.expiresAt,
                    });
                }
            } catch (e) {
                // If checking fails, proceed with resilience
            }
        }
    }

    try {
        const tenantDb = getTenantDb(cleanDbName);
        req.databaseName = cleanDbName;

        // Run within AsyncLocalStorage context
        tenantStorage.run(
            {
                dbName: cleanDbName,
                db: tenantDb,
            },
            () => {
                next();
            },
        );
    } catch (err: any) {
        res.status(500).json({
            message: `Gagal menghubungkan ke database '${cleanDbName}'`,
            error: err.message,
        });
    }
}
