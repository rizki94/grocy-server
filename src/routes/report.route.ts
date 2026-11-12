import { Router } from "express";
import {
    getBalanceSheet,
    getProductProfitability,
    getProfitLoss,
    getGlBalances,
    getCustomerOutstandingAr,
    getAgingReport,
    getPivotData,
    getTransactionRegister,
    getCogsReport,
} from "@/controllers/report.controller";

const reportRouter = Router();

reportRouter.get("/profit-loss", getProfitLoss);
reportRouter.get("/balance-sheet", getBalanceSheet);
reportRouter.get("/product-profitability", getProductProfitability);
reportRouter.get("/cogs", getCogsReport);
reportRouter.get("/gl-balances", getGlBalances);
reportRouter.get("/customer-outstanding-ar", getCustomerOutstandingAr);
reportRouter.get("/aging", getAgingReport);
reportRouter.get("/pivot-data", getPivotData);
reportRouter.get(
    "/transaction-register/:transactionType/:sortBy",
    getTransactionRegister,
);

export default reportRouter;
