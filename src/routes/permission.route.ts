import {
    createPermission,
    createPermissionGroup,
    getAllPermissions,
    getPaginatedPermissions,
    getPermissionById,
    getPermissionGroups,
    updatePermission,
} from "@/controllers/permission.controller";
import { Router } from "express";

export const permissionRouter = Router();

permissionRouter.get("/", getAllPermissions);
permissionRouter.get("/paginated", getPaginatedPermissions);
permissionRouter.get("/group", getPermissionGroups);
permissionRouter.get("/:id", getPermissionById);
permissionRouter.post("/", createPermission);
permissionRouter.put("/:id", updatePermission);
permissionRouter.post("/group", createPermissionGroup);

export default permissionRouter;
