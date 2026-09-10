import {
    createProduct,
    getAllProducts,
    getProductById,
    getPaginatedProducts,
    updateProduct,
    getActiveProducts,
    getProductByBarcode,
} from "@/controllers/product.controller";
import {
    downloadProductTemplate,
    previewProductImport,
    importProducts,
    importUpload,
} from "@/controllers/product-import.controller";
import { upload } from "@/services/storage";
import { Router } from "express";

const productRouter = Router();

// Import routes (must be before /:id to avoid route conflicts)
productRouter.get("/import/template", downloadProductTemplate);
productRouter.post("/import/preview", importUpload.single("file"), previewProductImport);
productRouter.post("/import", importProducts);

productRouter.get("/", getAllProducts);
productRouter.get("/paginated", getPaginatedProducts);
productRouter.get("/active", getActiveProducts);
productRouter.get("/:id", getProductById);
productRouter.get("/barcode/:barcode", getProductByBarcode);
productRouter.post("/", upload.array("images", 5), createProduct);
productRouter.put("/:id", upload.array("images", 5), updateProduct);

export default productRouter;
