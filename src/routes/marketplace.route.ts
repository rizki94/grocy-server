import { Router } from "express";
import {
    getAllMarketplaces,
    getPaginatedMarketplaces,
    getMarketplaceById,
    createMarketplace,
    updateMarketplace,
    deleteMarketplace,
    getMarketplaceFees,
    createMarketplaceFee,
    updateMarketplaceFee,
    deleteMarketplaceFee,
    getMarketplaceSyncLookup,
    matchMarketplaceSettlement,
    processMarketplaceSettlement,
    getEnumProductAttributes,
    getMarketplaceCategories,
    createBatchMarketplaceFees,
    deleteBatchMarketplaceFees,
    copyMarketplaceFees,
    getMarketplaceCategoryMatrix,
} from "@/controllers/marketplace.controller";

const marketplaceRouter = Router();

// 1. Static & Enum Attribute routes (must be before :id)
marketplaceRouter.get("/attributes/enum", getEnumProductAttributes);
marketplaceRouter.get("/categories", getMarketplaceCategories);
marketplaceRouter.get("/paginated", getPaginatedMarketplaces);
marketplaceRouter.get("/", getAllMarketplaces);

// 2. Settlement Reconciliation routes
marketplaceRouter.post("/settlement/match", matchMarketplaceSettlement);
marketplaceRouter.post("/settlement/process", processMarketplaceSettlement);

// 3. Fee Rules direct routes by feeId
marketplaceRouter.put("/fees/:feeId", updateMarketplaceFee);
marketplaceRouter.delete("/fees/:feeId", deleteMarketplaceFee);

// 4. Nested routes on :id (must be before generic /:id)
marketplaceRouter.get("/:id/categories", getMarketplaceCategories);
marketplaceRouter.get("/:id/category-matrix", getMarketplaceCategoryMatrix);
marketplaceRouter.get("/:id/fees", getMarketplaceFees);
marketplaceRouter.post("/:id/fees/batch", createBatchMarketplaceFees);
marketplaceRouter.post("/:id/fees/batch-delete", deleteBatchMarketplaceFees);
marketplaceRouter.post("/:id/fees/copy-from", copyMarketplaceFees);
marketplaceRouter.post("/:id/fees", createMarketplaceFee);
marketplaceRouter.post("/:id/sync-lookup", getMarketplaceSyncLookup);

// 5. Single marketplace basic CRUD
marketplaceRouter.get("/:id", getMarketplaceById);
marketplaceRouter.post("/", createMarketplace);
marketplaceRouter.put("/:id", updateMarketplace);
marketplaceRouter.delete("/:id", deleteMarketplace);

export default marketplaceRouter;
