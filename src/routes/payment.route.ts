import {
    createPaymentController,
    getOpenInvoices,
    getPaginatedPayments,
    getPaymentById,
    postPaymentController,
    updatePaymentController,
    voidPaymentController,
} from "@/controllers/payment.controller";
import { Router } from "express";

const paymentRouter = Router();

paymentRouter.get("/paginated", getPaginatedPayments);
paymentRouter.get("/open-invoices/:contactId", getOpenInvoices);
paymentRouter.get("/:id", getPaymentById);
paymentRouter.post("/", createPaymentController);
paymentRouter.put("/:id", updatePaymentController);
paymentRouter.put("/post/:id", postPaymentController);
paymentRouter.post("/:id/cancel", voidPaymentController);

export default paymentRouter;
