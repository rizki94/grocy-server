import {
    createSalesReturn,
    getAllSalesReturns,
    getPaginatedSalesReturns,
    getSalesReturnById,
    postSalesReturn,
    updateSalesReturn,
    cancelSalesReturn,
    deleteSalesReturn,
} from "@/controllers/sales-return.controller";
import { Router } from "express";

const salesReturnRouter = Router();

salesReturnRouter.get("/", getAllSalesReturns);
salesReturnRouter.get("/paginated", getPaginatedSalesReturns);
salesReturnRouter.get("/:id", getSalesReturnById);
salesReturnRouter.post("/", createSalesReturn);
salesReturnRouter.put("/:id", updateSalesReturn);
salesReturnRouter.put("/post/:id", postSalesReturn);
salesReturnRouter.post("/post/:id", postSalesReturn);
salesReturnRouter.post("/:id/post", postSalesReturn);
salesReturnRouter.post("/:id/cancel", cancelSalesReturn);
salesReturnRouter.delete("/:id", deleteSalesReturn);

export default salesReturnRouter;
