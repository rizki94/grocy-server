import {
    createGlAccount,
    getActiveGlAccounts,
    getAllGlAccounts,
    getGlAccountById,
    getLeafGlAccounts,
    getPaginatedGlAccounts,
    updateGlAccount,
} from "@/controllers/gl-account.controller";
import { Router } from "express";

export const glAccountRouter = Router();

glAccountRouter.get("/", getAllGlAccounts);
glAccountRouter.get("/active", getActiveGlAccounts);
glAccountRouter.get("/paginated", getPaginatedGlAccounts);
glAccountRouter.get("/leaf-account", getLeafGlAccounts);
glAccountRouter.get("/:id", getGlAccountById);
glAccountRouter.post("/", createGlAccount);
glAccountRouter.put("/:id", updateGlAccount);

export default glAccountRouter;
