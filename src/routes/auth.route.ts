import { login, loginNative, logout, refresh } from "@/controllers/auth.controller";
import { Router } from "express";

const authRouter = Router();

authRouter.post("/login", login);
authRouter.post("/login_native", loginNative);
authRouter.post("/logout", logout);
authRouter.get("/refresh", refresh);

export default authRouter;
