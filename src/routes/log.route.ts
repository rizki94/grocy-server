import { getLogs } from "@/controllers/log.controller";
import { Router } from "express";

const logsRouter = Router();

logsRouter.get("/", getLogs);

export default logsRouter;
