import { Request, Response, NextFunction } from "express";

declare global {
    namespace Express {
        interface User {
            branchId?: string | null;
            branch?: {
                id: string;
                code: string;
                name: string;
                isHq: boolean;
            } | null;
            isHq?: boolean;
        }
        interface Request {
            activeBranchId?: string | null;
            branchId?: string | null;
            isHq?: boolean;
        }
    }
}

export function branchMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
) {
    const user = req.user as any;
    if (!user) {
        return next();
    }

    const isHq = Boolean(user.isHq || user.branch?.isHq);
    req.isHq = isHq;

    // Header x-branch-id (or query branchId)
    const rawHeader = (req.headers["x-branch-id"] as string) || (req.query.branchId as string);

    if (isHq) {
        if (rawHeader && rawHeader !== "ALL" && rawHeader !== "null" && rawHeader !== "undefined") {
            req.activeBranchId = rawHeader;
            req.branchId = rawHeader;
        } else {
            // HQ user viewing all branches
            req.activeBranchId = null;
            req.branchId = user.branchId || null;
        }
    } else {
        // Non-HQ user is strictly locked to their assigned branchId
        req.activeBranchId = user.branchId || null;
        req.branchId = user.branchId || null;
    }

    next();
}
