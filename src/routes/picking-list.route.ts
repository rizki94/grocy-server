import {
    getPickingList,
    getInvoices,
    processPickingList,
    getPickingListAttributes,
} from "@/controllers/picking-list.controller";
import { Router } from "express";

const pickingListRouter = Router();

// Step 1: Get posted sales invoices by date range
pickingListRouter.get("/invoices", getInvoices);

// Product attributes for grouping
pickingListRouter.get("/attributes", getPickingListAttributes);

// Step 2: Process selected invoices into consolidated picking list
pickingListRouter.post("/process", processPickingList);

// Single invoice picking list view
pickingListRouter.get("/:id", getPickingList);

export default pickingListRouter;
