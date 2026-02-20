import {
    createProductUnit,
    getAllProductUnits,
    getProductUnitById,
    getPaginatedProductUnits,
    updateProductUnit,
} from "@/controllers/product-unit.controller";
import { Router } from "express";

const productUnitRouter = Router();

productUnitRouter.get("/", getAllProductUnits);
productUnitRouter.get("/paginated", getPaginatedProductUnits);
productUnitRouter.get("/:id", getProductUnitById);
productUnitRouter.post("/", createProductUnit);
productUnitRouter.put("/:id", updateProductUnit);

export default productUnitRouter;
