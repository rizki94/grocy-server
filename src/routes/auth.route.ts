import { login, logout } from "@/controllers/auth.controller";
import { Router } from "express";

const authRouter = Router();

authRouter.post("/login", login);
authRouter.post("/logout", logout);

export default authRouter;
