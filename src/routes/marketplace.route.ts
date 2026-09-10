import { Router } from "express";
import {
    getAllMarketplaces,
    getPaginatedMarketplaces,
    getMarketplaceById,
    createMarketplace,
    updateMarketplace,
    deleteMarketplace,
} from "@/controllers/marketplace.controller";

const marketplaceRouter = Router();

marketplaceRouter.get("/paginated", getPaginatedMarketplaces);
marketplaceRouter.get("/", getAllMarketplaces);
marketplaceRouter.get("/:id", getMarketplaceById);
marketplaceRouter.post("/", createMarketplace);
marketplaceRouter.put("/:id", updateMarketplace);
marketplaceRouter.delete("/:id", deleteMarketplace);

export default marketplaceRouter;
