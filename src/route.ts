import { Router } from "express";
import { isAuthenticated } from "./middleware/auth";
import authRouter from "./routes/auth.route";
import logsRouter from "./routes/log.route";
import customerRouter from "./routes/customer.route";
import productRouter from "./routes/product.route";
import purchaseRouter from "./routes/purchase.route";
import supplierRouter from "./routes/supplier.route";
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
import glAccountRouter from "./routes/gl-accout.route";
import paymentRouter from "./routes/payment.route";
import receivableRouter from "./routes/receivable.route";
import journalRoute from "./routes/journal.route";
import stockAdjustmentRouter from "./routes/stock-adjustment.route";
import warehouseRouter from "./routes/warehouse.route";
import priceGroupRouter from "./routes/price-group.route";

export const route = Router();

route.use("/auth", authRouter);
route.use(isAuthenticated);
route.get("/me", (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    res.json({
        user: req.user,
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
