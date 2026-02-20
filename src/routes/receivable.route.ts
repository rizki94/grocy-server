import {
    createReceivableController,
    getOpenReceivableInvoices,
    getPaginatedReceivables,
    getReceivableById,
    postReceivableController,
    updateReceivableController,
    voidReceivableController,
} from "@/controllers/receivable.controller";
import { Router } from "express";

const receivableRouter = Router();

receivableRouter.get("/paginated", getPaginatedReceivables);
receivableRouter.get("/:id", getReceivableById);
receivableRouter.get("/open-invoices/:contactId", getOpenReceivableInvoices);
receivableRouter.post("/", createReceivableController);
receivableRouter.put("/:id", updateReceivableController);
receivableRouter.put("/post/:id", postReceivableController);
receivableRouter.post("/:id/cancel", voidReceivableController);

export default receivableRouter;
