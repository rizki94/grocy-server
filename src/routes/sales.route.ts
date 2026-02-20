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

const salesRouter = Router();

salesRouter.get("/", getAllSales);
salesRouter.get("/paginated", getPaginatedSales);
salesRouter.get("/:id", getSalesById);
salesRouter.get("/posted/:contactId", getPostedSalesByContact);
salesRouter.post("/", createSales);
salesRouter.put("/:id", updateSales);
salesRouter.put("/post/:id", postSales);
salesRouter.post("/:id/cancel", cancelSales);

export default salesRouter;
