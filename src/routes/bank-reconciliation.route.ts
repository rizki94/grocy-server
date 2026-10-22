import { Router } from "express";
import {
    getPaginatedBankReconciliations,
    getBankReconciliationById,
    createBankReconciliation,
    updateBankReconciliationItems,
    reconcileBank,
    cancelBankReconciliation,
    deleteBankReconciliation,
} from "../controllers/bank-reconciliation.controller";
import { checkPeriodForTransactionMutation } from "@/helpers/period-closing.helper";

const bankReconciliationRouter = Router();

bankReconciliationRouter.get("/", getPaginatedBankReconciliations);
bankReconciliationRouter.get("/paginated", getPaginatedBankReconciliations);
bankReconciliationRouter.get("/:id", getBankReconciliationById);
bankReconciliationRouter.post("/", checkPeriodForTransactionMutation, createBankReconciliation);
bankReconciliationRouter.put("/:id/items", updateBankReconciliationItems);
bankReconciliationRouter.post("/:id/reconcile", checkPeriodForTransactionMutation, reconcileBank);
bankReconciliationRouter.post("/:id/cancel", checkPeriodForTransactionMutation, cancelBankReconciliation);
bankReconciliationRouter.delete("/:id", deleteBankReconciliation);

export default bankReconciliationRouter;
