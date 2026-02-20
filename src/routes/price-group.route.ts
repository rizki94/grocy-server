import {
    createPriceGroup,
    getAllPriceGroups,
    getPriceGroupById,
    getPaginatedPriceGroups,
    updatePriceGroup,
    getActivePriceGroups,
} from "@/controllers/price-group.controller";
import { Router } from "express";

const priceGroupRouter = Router();

priceGroupRouter.get("/", getAllPriceGroups);
priceGroupRouter.get("/active", getActivePriceGroups);
priceGroupRouter.get("/paginated", getPaginatedPriceGroups);
priceGroupRouter.get("/:id", getPriceGroupById);
priceGroupRouter.post("/", createPriceGroup);
priceGroupRouter.put("/:id", updatePriceGroup);

export default priceGroupRouter;
