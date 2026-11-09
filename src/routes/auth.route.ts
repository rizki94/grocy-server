import { login, loginNative, logout, refresh } from "@/controllers/auth.controller";
import { loginLimiter } from "@/middleware/rate-limiter";
import { Router } from "express";

const authRouter = Router();

authRouter.post("/login", loginLimiter, login);
authRouter.post("/login_native", loginLimiter, loginNative);
authRouter.post("/logout", logout);
authRouter.get("/refresh", refresh);

export default authRouter;
