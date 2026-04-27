import { Router } from "express";
import {
    createTransfer,
    getAllTransfers,
    getTransferById,
    updateTransfer,
    postTransfer,
    cancelTransfer,
    getPaginatedTransfers,
} from "../controllers/stock-transfer.controller";

const transferStockRouter = Router();

transferStockRouter.get("/", getAllTransfers);
transferStockRouter.get("/paginated", getPaginatedTransfers);
transferStockRouter.get("/:id", getTransferById);
transferStockRouter.post("/", createTransfer);
transferStockRouter.put("/:id", updateTransfer);
transferStockRouter.post("/:id/post", postTransfer);
transferStockRouter.post("/:id/cancel", cancelTransfer);

export default transferStockRouter;
