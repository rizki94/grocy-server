import {
    getMonitoringStock,
    getMovementStocks,
    getProductWarehouseStock,
} from "@/controllers/stock.controller";
import { Router } from "express";

export const stockRouter = Router();

stockRouter.get("/product/:productId", getProductWarehouseStock);
stockRouter.get("/monitoring", getMonitoringStock);
stockRouter.get("/movement", getMovementStocks);

export default stockRouter;
