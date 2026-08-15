import { Router } from "express";
import { isAuthenticated } from "./middleware/auth";
import authRouter from "./routes/auth.route";
import logsRouter from "./routes/log.route";
import customerRouter from "./routes/customer.route";
import productRouter from "./routes/product.route";
import purchaseRouter from "./routes/purchase.route";
import supplierRouter from "./routes/supplier.route";
import transferStockRouter from "./routes/stock-transfer.route";
import uploadRouter from "./routes/upload.route";
import productUnitRouter from "./routes/product-unit.route";
import productAttributeRouter from "./routes/product-attribute.route";
import taxRouter from "./routes/tax.route";
import stockRouter from "./routes/stock.route";
import roleRouter from "./routes/role.route";
import permissionRouter from "./routes/permission.route";
import userRouter from "./routes/user.route";
import salesRouter from "./routes/sales.route";
import dashboardRouter from "./routes/dashboard.route";
import reportRouter from "./routes/report.route";
import glAccountRouter from "./routes/gl-account.route";
import paymentRouter from "./routes/payment.route";
import receivableRouter from "./routes/receivable.route";
import journalRoute from "./routes/journal.route";
import stockAdjustmentRouter from "./routes/stock-adjustment.route";
import warehouseRouter from "./routes/warehouse.route";
import priceGroupRouter from "./routes/price-group.route";
import posSessionRouter from "./routes/pos-session.route";
import posRouter from "./routes/pos.route";
import paymentMethodRouter from "./routes/payment-method.route";
import bridgeRouter from "./routes/bridge.route";
import settingRouter from "./routes/setting.route";
import salesReturnRouter from "./routes/sales-return.route";
import purchaseReturnRouter from "./routes/purchase-return.route";
import messageRouter from "./routes/message.route";

import returnReasonRouter from "./routes/return-reason.route";

import routeGroupRouter from "./routes/route-group.route";
import { truckRouter } from "./routes/truck.route";
import { driverRouter } from "./routes/driver.route";
import { dispatchRouter } from "./routes/dispatch.route";

import { refresh } from "./controllers/auth.controller";

export const route = Router();

route.use("/auth", authRouter);
route.get("/refresh", refresh);
route.use("/bridge", bridgeRouter);
route.use(isAuthenticated);
route.get("/me", (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    const { password, ...safeUser } = req.user as any;
    res.json({
        user: safeUser,
    });
});
route.use("/dashboard", dashboardRouter);
route.use("/logs", logsRouter);
route.use("/users", userRouter);
route.use("/roles", roleRouter);
route.use("/permissions", permissionRouter);
route.use("/customers", customerRouter);
route.use("/suppliers", supplierRouter);
route.use("/products", productRouter);
route.use("/product-units", productUnitRouter);
route.use("/product-attributes", productAttributeRouter);
route.use("/purchases", purchaseRouter);
route.use("/sales", salesRouter);
route.use("/transfer-stocks", transferStockRouter);
route.use("/stocks", stockRouter);
route.use("/taxes", taxRouter);
route.use("/files", uploadRouter);
route.use("/reports", reportRouter);
route.use("/gl-accounts", glAccountRouter);
route.use("/payments", paymentRouter);
route.use("/receivables", receivableRouter);
route.use("/journals", journalRoute);
route.use("/stock-adjustments", stockAdjustmentRouter);
route.use("/warehouses", warehouseRouter);
route.use("/price-groups", priceGroupRouter);
route.use("/route-groups", routeGroupRouter);
route.use("/trucks", truckRouter);
route.use("/drivers", driverRouter);
route.use("/dispatch", dispatchRouter);
route.use("/pos-sessions", posSessionRouter);
route.use("/pos", posRouter);
route.use("/payment-methods", paymentMethodRouter);
route.use("/sales-return", salesReturnRouter);
route.use("/purchase-return", purchaseReturnRouter);
route.use("/return-reasons", returnReasonRouter);
route.use("/settings", settingRouter);
route.use("/chat", messageRouter);


