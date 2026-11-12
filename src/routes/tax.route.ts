import {
    createTax,
    getAllTaxes,
    getTaxById,
    getPaginatedTaxes,
    updateTax,
} from "@/controllers/tax.controller";
import {
    exportCoretaxDigunggungXml,
    exportCoretaxFakturKeluaranXml,
    getTaxReportingSummary,
    getTransactionFakturDetail,
    updateTransactionTaxMetadata,
} from "@/controllers/tax-reporting.controller";
import { Router } from "express";

const taxRouter = Router();

// Coretax reporting & Faktur Pajak routes (registered before /:id)
taxRouter.get("/reporting/summary", getTaxReportingSummary);
taxRouter.put("/reporting/transactions/:id", updateTransactionTaxMetadata);
taxRouter.get(
    "/reporting/transactions/:id/faktur-detail",
    getTransactionFakturDetail,
);
taxRouter.get(
    "/reporting/export/coretax-keluaran-xml",
    exportCoretaxFakturKeluaranXml,
);
taxRouter.get(
    "/reporting/export/coretax-digunggung-xml",
    exportCoretaxDigunggungXml,
);

taxRouter.get("/", getAllTaxes);
taxRouter.get("/paginated", getPaginatedTaxes);
taxRouter.get("/:id", getTaxById);
taxRouter.post("/", createTax);
taxRouter.put("/:id", updateTax);

export default taxRouter;
