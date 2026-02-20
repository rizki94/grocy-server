import {
    createSalesReturn,
    getAllSalesReturns,
    getPaginatedSalesReturns,
    getSalesReturnById,
    postSalesReturn,
    updateSalesReturn,
} from "@/controllers/sales-return.controller";
import { Router } from "express";

const salesReturnRouter = Router();

salesReturnRouter.get("/", getAllSalesReturns);
salesReturnRouter.get("/paginated", getPaginatedSalesReturns);
salesReturnRouter.get("/:id", getSalesReturnById);
salesReturnRouter.post("/", createSalesReturn);
salesReturnRouter.put("/:id", updateSalesReturn);
salesReturnRouter.post("/:id/post", postSalesReturn);

export default salesReturnRouter;
