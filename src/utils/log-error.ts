import { logger } from "@/logger";
import { Request } from "express";

export function logError(req: Request, err: any, msg?: string) {
    logger.error(
        {
            action: "error",
            table: "system",
            id: (req as any).user?.id,
            performedBy: (req as any).user?.id,
            method: req.method,
            url: req.originalUrl,
            body: req.body,
            query: req.query,
            params: req.params,
            stack: err.stack,
        },
        msg || err.message
    );
}
