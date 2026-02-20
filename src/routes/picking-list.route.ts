import { getPickingList, getBulkPickingList, getPickingListByDateRange } from "@/controllers/picking-list.controller";
import { Router } from "express";

const pickingListRouter = Router();

pickingListRouter.get("/date-range", getPickingListByDateRange);
pickingListRouter.get("/:id", getPickingList);
pickingListRouter.post("/bulk", getBulkPickingList);

export default pickingListRouter;
