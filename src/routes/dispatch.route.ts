import { Router } from "express";
import {
    getUnassignedInvoices,
    getDispatchBoard,
    getPaginatedDispatches,
    saveDispatch,
    deleteDispatch,
    getBatchPrintData,
    getAllBatchPrintData,
} from "@/controllers/dispatch.controller";

export const dispatchRouter = Router();

dispatchRouter.get("/paginated", getPaginatedDispatches);
dispatchRouter.get("/unassigned", getUnassignedInvoices);
dispatchRouter.get("/board", getDispatchBoard);
dispatchRouter.post("/save", saveDispatch);
dispatchRouter.delete("/:id", deleteDispatch);
dispatchRouter.get("/print-all", getAllBatchPrintData);
dispatchRouter.get("/print/:deliveryId", getBatchPrintData);
