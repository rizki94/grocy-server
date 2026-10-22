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

import { checkPeriodForTransactionMutation } from "@/helpers/period-closing.helper";

const purchaseRouter = Router();

purchaseRouter.get("/", getAllPurchases);
purchaseRouter.get("/paginated", getPaginatedPurchases);
purchaseRouter.get("/last-price", getLastPurchasePrice);
purchaseRouter.get("/posted/:contactId", getPostedPurchasesByContact);
purchaseRouter.get("/:id", getPurchaseById);
purchaseRouter.post("/", checkPeriodForTransactionMutation, createPurchase);
purchaseRouter.put("/:id", checkPeriodForTransactionMutation, updatePurchase);
purchaseRouter.put("/post/:id", checkPeriodForTransactionMutation, postPurchase);
purchaseRouter.post("/:id/cancel", checkPeriodForTransactionMutation, cancelPurchase);


export default purchaseRouter;
