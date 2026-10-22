import {
    getPaginatedIncomes,
    getIncomeById,
    createIncome,
    updateIncome,
    postIncome,
    cancelIncome,
} from "@/controllers/income.controller";
import { Router } from "express";

import { checkPeriodForTransactionMutation } from "@/helpers/period-closing.helper";

const incomeRouter = Router();

incomeRouter.get("/", getPaginatedIncomes);
incomeRouter.get("/paginated", getPaginatedIncomes);
incomeRouter.get("/:id", getIncomeById);
incomeRouter.post("/", checkPeriodForTransactionMutation, createIncome);
incomeRouter.put("/:id", checkPeriodForTransactionMutation, updateIncome);
incomeRouter.post("/:id/post", checkPeriodForTransactionMutation, postIncome);
incomeRouter.post("/:id/cancel", checkPeriodForTransactionMutation, cancelIncome);

export default incomeRouter;
