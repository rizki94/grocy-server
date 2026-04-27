import { Router } from "express";
import {
    getActiveSession,
    openSession,
    closeSession,
    getAllSessions,
    getSessionSummary,
    getOpeningBalance
} from "@/controllers/pos-session.controller";

const router = Router();

router.get("/", getAllSessions);
router.get("/active", getActiveSession);
router.get("/opening-balance", getOpeningBalance);
router.get("/:id/summary", getSessionSummary);
router.post("/open", openSession);
router.post("/:id/close", closeSession);

export default router;
