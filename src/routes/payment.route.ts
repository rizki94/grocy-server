import {
    createPaymentController,
    getOpenInvoices,
    getPaginatedPayments,
    getPaymentById,
    getPaymentsByTransaction,
    postPaymentController,
    updatePaymentController,
    voidPaymentController,
    deletePaymentController,
} from "@/controllers/payment.controller";
import { Router } from "express";

const paymentRouter = Router();

paymentRouter.get("/paginated", getPaginatedPayments);
paymentRouter.get("/open-invoices/:contactId", getOpenInvoices);
paymentRouter.get("/:id", getPaymentById);
paymentRouter.get("/by-transaction/:transactionId", getPaymentsByTransaction);
paymentRouter.post("/", createPaymentController);
paymentRouter.put("/:id", updatePaymentController);
paymentRouter.put("/post/:id", postPaymentController);
paymentRouter.post("/:id/cancel", voidPaymentController);
paymentRouter.delete("/:id", deletePaymentController);

export default paymentRouter;
