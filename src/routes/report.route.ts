import { Router } from "express";
import {
    getBalanceSheet,
    getProductProfitability,
    getProfitLoss,
    getGlBalances,
    getCustomerOutstandingAr,
    getPivotData,
    getTransactionSummary,
    getTransactionRegister,
} from "@/controllers/report.controller";

const reportRouter = Router();

reportRouter.get("/profit-loss", getProfitLoss);
reportRouter.get("/balance-sheet", getBalanceSheet);
reportRouter.get("/product-profitability", getProductProfitability);
reportRouter.get("/gl-balances", getGlBalances);
reportRouter.get("/customer-outstanding-ar", getCustomerOutstandingAr);
reportRouter.get("/pivot-data", getPivotData);
reportRouter.get("/transaction-summary", getTransactionSummary);
reportRouter.get(
    "/transaction-register/:transactionType/:sortBy",
    getTransactionRegister,
);

export default reportRouter;
