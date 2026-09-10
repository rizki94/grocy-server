import { Router } from "express";
import {
    previewBridgeImport,
    submitBridgeImport,
} from "@/controllers/bridge-import.controller";

const bridgeImportRouter = Router();

bridgeImportRouter.post("/preview", previewBridgeImport);
bridgeImportRouter.post("/submit", submitBridgeImport);

export default bridgeImportRouter;
