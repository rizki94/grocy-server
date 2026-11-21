import { Router } from "express";
import {
    getDataIntegrityAudit,
    reconcileDataIntegrity,
} from "../controllers/data-audit.controller";

const dataAuditRouter = Router();

dataAuditRouter.get("/", getDataIntegrityAudit);
dataAuditRouter.post("/reconcile", reconcileDataIntegrity);

export default dataAuditRouter;
