import {
    createRole,
    getAllRoles,
    getPaginatedRoles,
    getRoleById,
    updatePermissions,
    updateRole,
} from "@/controllers/role.controller";
import { Router } from "express";

export const roleRouter = Router();

roleRouter.get("/", getAllRoles);
roleRouter.get("/paginated", getPaginatedRoles);
roleRouter.get("/:id", getRoleById);
roleRouter.post("/", createRole);
roleRouter.put("/:id", updateRole);
roleRouter.put("/permission/:id", updatePermissions);

export default roleRouter;
