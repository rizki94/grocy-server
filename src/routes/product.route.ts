import {
    createProduct,
    getAllProducts,
    getProductById,
    getPaginatedProducts,
    updateProduct,
    getActiveProducts,
} from "@/controllers/product.controller";
import { upload } from "@/services/storage";
import { Router } from "express";

const productRouter = Router();

productRouter.get("/", getAllProducts);
productRouter.get("/paginated", getPaginatedProducts);
productRouter.get("/active", getActiveProducts);
productRouter.get("/:id", getProductById);
productRouter.post("/", upload.array("images", 5), createProduct);
productRouter.put("/:id", upload.array("images", 5), updateProduct);

export default productRouter;
