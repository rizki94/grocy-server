import {
    forceLogoutIdleSessions,
    forceLogoutSession,
    getActiveSessions,
} from "@/controllers/session.controller";
import { NextFunction, Request, Response, Router } from "express";

function requireSysAdmin(req: Request, res: Response, next: NextFunction) {
    const permissions = (req.user as { permissions?: string[] } | undefined)?.permissions || [];
    if (!permissions.includes("sysadmin.access")) {
        return res.status(403).json({
            message: "Forbidden: sysadmin.access permission required",
        });
    }
    return next();
}

const sessionRouter = Router();

sessionRouter.use(requireSysAdmin);
sessionRouter.get("/", getActiveSessions);
sessionRouter.post("/force-logout-idle", forceLogoutIdleSessions);
sessionRouter.delete("/:sid", forceLogoutSession);

export default sessionRouter;

