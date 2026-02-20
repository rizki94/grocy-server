import { Router } from "express";
import {
    getBalanceSheet,
    getProductProfitability,
    getProfitLoss,
} from "@/controllers/report.controller";

const reportRouter = Router();

reportRouter.get("/profit-loss", getProfitLoss);
reportRouter.get("/balance-sheet", getBalanceSheet);
reportRouter.get("/product-profitability", getProductProfitability);

export default reportRouter;
