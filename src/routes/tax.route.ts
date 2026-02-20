import {
    createTax,
    getAllTaxes,
    getTaxById,
    getPaginatedTaxes,
    updateTax,
} from "@/controllers/tax.controller";
import { Router } from "express";

const taxRouter = Router();

taxRouter.get("/", getAllTaxes);
taxRouter.get("/paginated", getPaginatedTaxes);
taxRouter.get("/:id", getTaxById);
taxRouter.post("/", createTax);
taxRouter.put("/:id", updateTax);

export default taxRouter;
