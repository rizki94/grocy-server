import {
    createUser,
    getAllUsers,
    getPaginatedUsers,
    getUserById,
    updateUser,
    updateUserPosSetup,
} from "@/controllers/user.controller";
import e, { Router } from "express";

export const userRouter = Router();

userRouter.get("/", getAllUsers);
userRouter.get("/paginated", getPaginatedUsers);
userRouter.get("/:id", getUserById);
userRouter.post("/", createUser);
userRouter.put("/:id", updateUser);
userRouter.put("/:id/pos-setup", updateUserPosSetup);

export default userRouter;
