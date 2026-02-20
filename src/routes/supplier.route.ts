import {
    createSupplier,
    getAllSuppliers,
    getSupplierById,
    getPaginatedSuppliers,
    updateSupplier,
    getActiveSuppliers,
} from "@/controllers/supplier.controller";
import { Router } from "express";

const supplierRouter = Router();

supplierRouter.get("/", getAllSuppliers);
supplierRouter.get("/active", getActiveSuppliers);
supplierRouter.get("/paginated", getPaginatedSuppliers);
supplierRouter.get("/:id", getSupplierById);
supplierRouter.post("/", createSupplier);
supplierRouter.put("/:id", updateSupplier);

export default supplierRouter;
