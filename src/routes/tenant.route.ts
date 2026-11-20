import { Router } from "express";
import {
    getDatabasesHandler,
    checkDatabaseHandler,
    createWorkspaceHandler,
    getCurrentTenantHandler,
    syncPermissionsHandler,
    verifyTokenHandler,
    getTenantSubscriptionHandler,
} from "@/controllers/tenant.controller";

const tenantRouter = Router();

// Public routes for landing page & onboarding wizard
tenantRouter.get("/databases", getDatabasesHandler);
tenantRouter.get("/check-name", checkDatabaseHandler);
tenantRouter.get("/verify-token", verifyTokenHandler);
tenantRouter.post("/create-workspace", createWorkspaceHandler);
tenantRouter.get("/current", getCurrentTenantHandler);
tenantRouter.get("/subscription", getTenantSubscriptionHandler);
tenantRouter.post("/sync-permissions", syncPermissionsHandler);

export default tenantRouter;
