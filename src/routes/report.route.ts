import { Router } from "express";
import {
    getBalanceSheet,
    getProductProfitability,
    getProfitLoss,
    getGlBalances,
} from "@/controllers/report.controller";

const reportRouter = Router();

reportRouter.get("/profit-loss", getProfitLoss);
reportRouter.get("/balance-sheet", getBalanceSheet);
reportRouter.get("/product-profitability", getProductProfitability);
reportRouter.get("/gl-balances", getGlBalances);

export default reportRouter;
