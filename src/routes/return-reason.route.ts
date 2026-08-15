import { Router } from "express";
import {
    getAllReturnReasons,
    createReturnReason,
    updateReturnReason,
    deleteReturnReason,
} from "@/controllers/return-reason.controller";

const returnReasonRouter = Router();

returnReasonRouter.get("/", getAllReturnReasons);
returnReasonRouter.post("/", createReturnReason);
returnReasonRouter.put("/:id", updateReturnReason);
returnReasonRouter.delete("/:id", deleteReturnReason);

export default returnReasonRouter;
