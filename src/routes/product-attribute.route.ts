import {
    createProductAttribute,
    getAllProductAttributes,
    getProductAttributeById,
    getPaginatedProductAttributes,
    updateProductAttribute,
} from "@/controllers/product-attribute.controller";
import { Router } from "express";

const productAttributeRouter = Router();

productAttributeRouter.get("/", getAllProductAttributes);
productAttributeRouter.get("/paginated", getPaginatedProductAttributes);
productAttributeRouter.get("/:id", getProductAttributeById);
productAttributeRouter.post("/", createProductAttribute);
productAttributeRouter.put("/:id", updateProductAttribute);

export default productAttributeRouter;
