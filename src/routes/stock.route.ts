import {
    getMonitoringStock,
    getMovementStocks,
} from "@/controllers/stock.controller";
import { Router } from "express";

export const stockRouter = Router();

stockRouter.get("/monitoring", getMonitoringStock);
stockRouter.get("/movement", getMovementStocks);

export default stockRouter;
