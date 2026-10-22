import {
    getPaginatedExpenses,
    getExpenseById,
    createExpense,
    updateExpense,
    postExpense,
    cancelExpense,
} from "@/controllers/expense.controller";
import { Router } from "express";

import { checkPeriodForTransactionMutation } from "@/helpers/period-closing.helper";

const expenseRouter = Router();

expenseRouter.get("/", getPaginatedExpenses);
expenseRouter.get("/paginated", getPaginatedExpenses);
expenseRouter.get("/:id", getExpenseById);
expenseRouter.post("/", checkPeriodForTransactionMutation, createExpense);
expenseRouter.put("/:id", checkPeriodForTransactionMutation, updateExpense);
expenseRouter.post("/:id/post", checkPeriodForTransactionMutation, postExpense);
expenseRouter.post("/:id/cancel", checkPeriodForTransactionMutation, cancelExpense);

export default expenseRouter;
