import { login, loginNative, logout, refresh } from "@/controllers/auth.controller";
import { loginLimiter } from "@/middleware/rate-limiter";
import { isAuthenticated } from "@/middleware/auth";
import { Router } from "express";

const authRouter = Router();

authRouter.post("/login", loginLimiter, login);
authRouter.post("/login_native", loginLimiter, loginNative);
authRouter.post("/logout", logout);
authRouter.get("/refresh", refresh);

authRouter.get("/heartbeat", isAuthenticated, (req, res) => {
    res.json({
        ok: true,
        activeAt: (req.session as any)?.meta?.lastActivityAt || new Date().toISOString(),
    });
});

export default authRouter;
