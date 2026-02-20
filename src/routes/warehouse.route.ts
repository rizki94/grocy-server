import {
    createWarehouse,
    getAllWarehouses,
    getWarehouseById,
    getPaginatedWarehouses,
    updateWarehouse,
    getActiveWarehouses,
} from "@/controllers/warehouse.controller";
import { Router } from "express";

const warehouseRouter = Router();

warehouseRouter.get("/", getAllWarehouses);
warehouseRouter.get("/active", getActiveWarehouses);
warehouseRouter.get("/paginated", getPaginatedWarehouses);
warehouseRouter.get("/:id", getWarehouseById);
warehouseRouter.post("/", createWarehouse);
warehouseRouter.put("/:id", updateWarehouse);

export default warehouseRouter;
