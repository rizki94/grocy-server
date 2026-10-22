import { Router } from "express";
import {
    getPaginatedStockOpnames,
    getStockOpnameById,
    createStockOpname,
    updateStockOpnameItems,
    completeStockOpname,
    cancelStockOpname,
    deleteStockOpname,
} from "../controllers/stock-opname.controller";
import { checkPeriodForTransactionMutation } from "@/helpers/period-closing.helper";

const stockOpnameRouter = Router();

stockOpnameRouter.get("/", getPaginatedStockOpnames);
stockOpnameRouter.get("/paginated", getPaginatedStockOpnames);
stockOpnameRouter.get("/:id", getStockOpnameById);
stockOpnameRouter.post("/", checkPeriodForTransactionMutation, createStockOpname);
stockOpnameRouter.put("/:id/items", updateStockOpnameItems);
stockOpnameRouter.post("/:id/complete", checkPeriodForTransactionMutation, completeStockOpname);
stockOpnameRouter.post("/:id/cancel", checkPeriodForTransactionMutation, cancelStockOpname);
stockOpnameRouter.delete("/:id", deleteStockOpname);

export default stockOpnameRouter;
