import { Router } from "express";
import {
    checkout,
    getOpenPosInvoices,
    settlePosInvoice,
    recordAuditLog,
} from "@/controllers/pos.controller";

const router = Router();

router.post("/checkout", checkout);
router.get("/open-invoices", getOpenPosInvoices);
router.post("/settle", settlePosInvoice);
router.post("/audit-log", recordAuditLog);

export default router;
