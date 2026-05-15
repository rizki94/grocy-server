import { Router } from "express";
import { getProductStockList, getDashboardOmzetMobile } from "@/controllers/bridge.controller";

const bridgeRouter = Router();

bridgeRouter.get("/product_stock_list", getProductStockList);
bridgeRouter.get("/dashboard_omzet_mobile", getDashboardOmzetMobile);

export default bridgeRouter;
