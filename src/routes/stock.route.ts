import {
    getMonitoringStock,
    getMovementStocks,
    getProductWarehouseStock,
    getLowStockProducts,
    createRestockPurchaseDraft,
    getExpiryStockReport,
} from "@/controllers/stock.controller";
import { Router } from "express";

export const stockRouter = Router();

// Low stock assistant & draft PO creation
stockRouter.get("/low-stock", getLowStockProducts);
stockRouter.post("/create-restock-po", createRestockPurchaseDraft);

// Specific product and monitoring
stockRouter.get("/product/:productId", getProductWarehouseStock);
stockRouter.get("/monitoring", getMonitoringStock);
stockRouter.get("/movement", getMovementStocks);
stockRouter.get("/expiry", getExpiryStockReport);

export default stockRouter;
