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

const salesRouter = Router();

salesRouter.get("/", getAllSales);
salesRouter.get("/paginated", getPaginatedSales);
salesRouter.post("/batch-analyze", analyzeBatchSales);
salesRouter.post("/batch-update-items", updateBatchSalesItems);
salesRouter.get("/posted/:contactId", getPostedSalesByContact);
salesRouter.get("/:id", getSalesById);
salesRouter.post("/", createSales);
salesRouter.put("/:id", updateSales);
salesRouter.put("/post/:id", postSales);
salesRouter.post("/:id/cancel", cancelSales);


export default salesRouter;
