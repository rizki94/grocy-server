import { Router } from "express";
import {
    createAdjustment,
    getAdjustmentById,
    getAllAdjustments,
    getPaginatedAdjustments,
    postAdjustment,
    updateAdjustment,
    cancelAdjustment,
} from "../controllers/stock-adjustment.controller";

const router = Router();

router.use((req, _res, next) => {
    console.log(`[StockAdjustmentRoute] ${req.method} ${req.url}`);
    next();
});

router.get("/", getAllAdjustments);
router.get("/paginated", getPaginatedAdjustments);
router.get("/:id", getAdjustmentById);
router.post("/", createAdjustment);
router.put("/:id", updateAdjustment);
router.post("/:id/post", postAdjustment);
router.post("/:id/cancel", cancelAdjustment);

export default router;
