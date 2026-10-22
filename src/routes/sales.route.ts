import {
    createSales,
    getAllSales,
    getPaginatedSales,
    getSalesById,
    postSales,
    updateSales,
    getPostedSalesByContact,
    cancelSales,
} from "@/controllers/sales.controller";
import { Router } from "express";

import {
    analyzeBatchSales,
    updateBatchSalesItems,
} from "@/controllers/batch-sales.controller";

import { checkPeriodForTransactionMutation } from "@/helpers/period-closing.helper";

const salesRouter = Router();

salesRouter.get("/", getAllSales);
salesRouter.get("/paginated", getPaginatedSales);
salesRouter.post("/batch-analyze", analyzeBatchSales);
salesRouter.post("/batch-update-items", updateBatchSalesItems);
salesRouter.get("/posted/:contactId", getPostedSalesByContact);
salesRouter.get("/:id", getSalesById);
salesRouter.post("/", checkPeriodForTransactionMutation, createSales);
salesRouter.put("/:id", checkPeriodForTransactionMutation, updateSales);
salesRouter.put("/post/:id", checkPeriodForTransactionMutation, postSales);
salesRouter.post("/:id/cancel", checkPeriodForTransactionMutation, cancelSales);


export default salesRouter;
