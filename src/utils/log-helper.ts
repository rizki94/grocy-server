import { logger } from "@/logger";
import { Request } from "express";

interface ActionLogOptions {
    action: "insert" | "update" | "delete" | "login";
    table: string;
    oldData?: any;
    data?: any;
    changes?: any;
    id?: string;
    userId?: string;
    msg?: string;
}

export function logAction(req: Request, options: ActionLogOptions) {
    logger.info(
        {
            action: options.action,
            table: options.table,
            oldData: options.oldData,
            data: options.data,
            changes: options.changes,
            id: options.id,
            userId: options.userId,
        },
        options.msg || `${options.action} on ${options.table}`
    );
}
