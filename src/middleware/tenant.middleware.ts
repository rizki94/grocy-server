import { Request, Response, NextFunction } from "express";
import {
    tenantStorage,
    getTenantDb,
    getDefaultDatabaseName,
    sanitizeDatabaseName,
} from "@/services/tenant.service";

declare global {
    namespace Express {
        interface Request {
            databaseName?: string;
        }
    }
}

export function tenantMiddleware(
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
