import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { getClientIp, type SessionMeta } from "@/helpers/session.helper";

const ACTIVITY_UPDATE_INTERVAL_MS = 30_000;
const INACTIVITY_LIMIT_MS =
    (Number(process.env.SESSION_INACTIVITY_HOURS) || 12) * 60 * 60 * 1000;

export function isAuthenticated(
    req: Request,
    res: Response,
    next: NextFunction
) {
    // 1. Check Session (Passport)
    if (req.isAuthenticated && req.isAuthenticated()) {
        if (req.session) {
            const sessAny = req.session as typeof req.session & {
                meta?: SessionMeta;
            };
            const now = Date.now();
            const lastActivityMs = sessAny.meta?.lastActivityAt
                ? new Date(sessAny.meta.lastActivityAt).getTime()
                : 0;

            // Inactivity Guard: If session was inactive for longer than INACTIVITY_LIMIT_MS, terminate it
            if (lastActivityMs > 0 && now - lastActivityMs > INACTIVITY_LIMIT_MS) {
                req.logout(() => {});
                req.session.destroy(() => {});
                res.clearCookie("connect.sid");
                return res.status(401).json({
                    code: "SESSION_EXPIRED_INACTIVITY",
                    message: "Sesi telah berakhir karena tidak ada aktivitas. Silakan login kembali.",
                });
            }

            // Update activity meta throttled to every 30 seconds
            if (!sessAny.meta || now - lastActivityMs > ACTIVITY_UPDATE_INTERVAL_MS) {
                const nowIso = new Date(now).toISOString();
                const reqUser = req.user as { id?: string; username?: string } | undefined;
                sessAny.meta = {
                    userId: sessAny.meta?.userId || reqUser?.id || "",
                    username: sessAny.meta?.username || reqUser?.username || "",
                    ip: sessAny.meta?.ip || getClientIp(req),
                    userAgent:
                        sessAny.meta?.userAgent ||
                        req.get("User-Agent") ||
                        "unknown",
                    loginAt: sessAny.meta?.loginAt || nowIso,
                    lastActivityAt: nowIso,
                };
            }
        }
        return next();
    }

    // 2. Check Bearer Token (Mobile)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.split(" ")[1];
        try {
            const decoded = jwt.verify(
                token,
                process.env.JWT_SECRET || "secret"
            ) as any;
            
            // Minimal user object
            req.user = decoded;
            return next();
        } catch (err) {
            return res.status(401).json({ message: "Invalid or expired token" });
        }
    }

    return res.status(401).json({ message: "unauthorized" });
}
