import { createUser, getAllUsers, getPaginatedUsers, getUserById, updateUser } from "@/controllers/user.controller";
import e, { Router } from "express";

export const userRouter = Router();

userRouter.get("/", getAllUsers);
userRouter.get("/paginated", getPaginatedUsers);
userRouter.get("/:id", getUserById);
userRouter.post("/", createUser);
userRouter.put("/:id", updateUser);

export default userRouter;
