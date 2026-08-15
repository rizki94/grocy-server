import { Router } from "express";
import {
    getAllRouteGroups,
    getActiveRouteGroups,
    getRouteGroupById,
    createRouteGroup,
    updateRouteGroup,
    getPaginatedRouteGroups,
} from "@/controllers/route-group.controller";

const routeGroupRouter = Router();

routeGroupRouter.get("/active", getActiveRouteGroups);
routeGroupRouter.get("/paginated", getPaginatedRouteGroups);
routeGroupRouter.get("/", getAllRouteGroups);
routeGroupRouter.get("/:id", getRouteGroupById);
routeGroupRouter.post("/", createRouteGroup);
routeGroupRouter.put("/:id", updateRouteGroup);

export default routeGroupRouter;
