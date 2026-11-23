import { Request, Response, NextFunction } from "express";

/**
 * Middleware: PIN Session Guard
 * Sesi Kasir PIN ditolak dari semua endpoint administrasi & manajemen.
 * Hanya endpoint POS yang diperbolehkan.
 */
export function pinSessionGuard(
    req: Request,
    res: Response,
    next: NextFunction
) {
    const isPinSession =
        (req.session as any)?.isPinSession === true ||
        (req.user as any)?.isPinSession === true;

    if (!isPinSession) return next();

    // Whitelist path yang diizinkan untuk sesi PIN kasir
    const allowedPrefixes = [
        "/me",
        "/auth",
        "/pos",
        "/pos-sessions",
        "/bridge",
        "/products",
        "/product-units",
        "/product-attributes",
        "/customers",
        "/payment-methods",
        "/stocks",
    ];

    const targetPath = req.baseUrl || req.path || "";
    const isAllowed = allowedPrefixes.some((prefix) =>
        targetPath.startsWith(prefix)
    );

    if (!isAllowed) {
        return res.status(403).json({
            code: "PIN_SESSION_FORBIDDEN",
            message:
                "Akses Ditolak: Sesi PIN Kasir tidak memiliki izin untuk mengakses halaman atau data administrasi. Silakan login menggunakan akun dan kata sandi.",
        });
    }

    next();
}
