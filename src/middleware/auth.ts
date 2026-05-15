import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export function isAuthenticated(
    req: Request,
    res: Response,
    next: NextFunction
) {
    // 1. Check Session (Passport)
    if (req.isAuthenticated && req.isAuthenticated()) {
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
            
            // Minimal user object, you might want to fetch full details from DB
            req.user = decoded;
            return next();
        } catch (err) {
            return res.status(401).json({ message: "Invalid or expired token" });
        }
    }

    return res.status(401).json({ message: "unauthorized" });
}
