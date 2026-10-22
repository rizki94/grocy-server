import { Router } from "express";
import {
    getPeriodClosingOverview,
    previewPeriodClosing,
    executePeriodClosing,
    reopenPeriodClosing,
} from "../controllers/period-closing.controller";

const periodClosingRouter = Router();

periodClosingRouter.get("/overview", getPeriodClosingOverview);
periodClosingRouter.get("/preview", previewPeriodClosing);
periodClosingRouter.post("/close", executePeriodClosing);
periodClosingRouter.post("/reopen", reopenPeriodClosing);

export default periodClosingRouter;
