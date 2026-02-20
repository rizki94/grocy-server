import {
    createPurchaseReturn,
    getAllPurchaseReturns,
    getPaginatedPurchaseReturns,
    getPurchaseReturnById,
    postPurchaseReturn,
    updatePurchaseReturn,
} from "@/controllers/purchase-return.controller";
import { Router } from "express";

const purchaseReturnRouter = Router();

purchaseReturnRouter.get("/", getAllPurchaseReturns);
purchaseReturnRouter.get("/paginated", getPaginatedPurchaseReturns);
purchaseReturnRouter.get("/:id", getPurchaseReturnById);
purchaseReturnRouter.post("/", createPurchaseReturn);
purchaseReturnRouter.put("/:id", updatePurchaseReturn);
purchaseReturnRouter.post("/:id/post", postPurchaseReturn);

export default purchaseReturnRouter;
