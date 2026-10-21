import {
    getPaginatedExpenses,
    getExpenseById,
    createExpense,
    cancelExpense,
} from "@/controllers/expense.controller";
import { Router } from "express";

const expenseRouter = Router();

expenseRouter.get("/", getPaginatedExpenses);
expenseRouter.get("/paginated", getPaginatedExpenses);
expenseRouter.get("/:id", getExpenseById);
expenseRouter.post("/", createExpense);
expenseRouter.post("/:id/cancel", cancelExpense);

export default expenseRouter;
