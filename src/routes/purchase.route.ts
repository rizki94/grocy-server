import {
    createPurchase,
    getAllPurchases,
    getPurchaseById,
    getPaginatedPurchases,
    updatePurchase,
    postPurchase,
    getLastPurchasePrice,
    getPostedPurchasesByContact,
    cancelPurchase,
} from "@/controllers/purchase.controller";
import { Router } from "express";

const purchaseRouter = Router();

purchaseRouter.get("/", getAllPurchases);
purchaseRouter.get("/paginated", getPaginatedPurchases);
purchaseRouter.get("/last-price", getLastPurchasePrice);
purchaseRouter.get("/:id", getPurchaseById);
purchaseRouter.get("/posted/:contactId", getPostedPurchasesByContact);
purchaseRouter.post("/", createPurchase);
purchaseRouter.put("/:id", updatePurchase);
purchaseRouter.put("/post/:id", postPurchase);
purchaseRouter.post("/:id/cancel", cancelPurchase);

export default purchaseRouter;
