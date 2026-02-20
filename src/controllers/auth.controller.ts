import { logAction } from "@/utils/log-helper";
import { UserModel } from "@/validators/user.validator";
import type { NextFunction, Request, Response } from "express";
import passport from "passport";

export const login = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    passport.authenticate(
        "local",
        (err: unknown, user: UserModel | false, info: { message?: string }) => {
            if (err) {
                return res
                    .status(500)
                    .json({ message: "Internal server error", error: err });
            }

            if (!user) {
                return res
                    .status(401)
                    .json({ message: info?.message || "Invalid credentials" });
            }

            req.logIn(user, (err) => {
                if (err) {
                    return res
                        .status(500)
                        .json({ message: "Login failed", error: err });
                }

                logAction(req, {
                    action: "login",
                    table: "users",
                    data: {
                        userId: user.id,
                        username: user.username,
                        ip: req.ip,
                        userAgent: req.get("User-Agent"),
                        timestamp: new Date().toISOString(),
                    },
                    userId: user.id,
                    msg: `logged in user #${user.id}`,
                });

                return res.status(200).json({
                    message: "Login success",
                    user: {
                        id: user.id,
                        username: user.username,
                    },
                });
            });
        }
    )(req, res, next);
};

export const logout = async (req: Request, res: Response) => {
    req.logout(() => {
        res.send("Logged out");
    });
};
