import { getDashboardStats } from "@/controllers/dashboard.controller";
import { Router } from "express";

const dashboardRouter = Router();

dashboardRouter.get("/stats", getDashboardStats);

export default dashboardRouter;
