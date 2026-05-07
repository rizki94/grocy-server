import { Router } from "express";
import {
    getBalanceSheet,
    getProductProfitability,
    getProfitLoss,
    getGlBalances,
    getCustomerOutstandingAr,
} from "@/controllers/report.controller";

const reportRouter = Router();

reportRouter.get("/profit-loss", getProfitLoss);
reportRouter.get("/balance-sheet", getBalanceSheet);
reportRouter.get("/product-profitability", getProductProfitability);
reportRouter.get("/gl-balances", getGlBalances);
reportRouter.get("/customer-outstanding-ar", getCustomerOutstandingAr);

export default reportRouter;
