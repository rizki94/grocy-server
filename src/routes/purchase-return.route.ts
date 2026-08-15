import {
    createPurchaseReturn,
    getAllPurchaseReturns,
    getPaginatedPurchaseReturns,
    getPurchaseReturnById,
    postPurchaseReturn,
    updatePurchaseReturn,
    cancelPurchaseReturn,
} from "@/controllers/purchase-return.controller";
import { Router } from "express";

const purchaseReturnRouter = Router();

purchaseReturnRouter.get("/", getAllPurchaseReturns);
purchaseReturnRouter.get("/paginated", getPaginatedPurchaseReturns);
purchaseReturnRouter.get("/:id", getPurchaseReturnById);
purchaseReturnRouter.post("/", createPurchaseReturn);
purchaseReturnRouter.put("/:id", updatePurchaseReturn);
purchaseReturnRouter.put("/post/:id", postPurchaseReturn);
purchaseReturnRouter.post("/post/:id", postPurchaseReturn);
purchaseReturnRouter.post("/:id/post", postPurchaseReturn);
purchaseReturnRouter.post("/:id/cancel", cancelPurchaseReturn);


export default purchaseReturnRouter;
