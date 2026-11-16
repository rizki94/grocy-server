import { Router } from "express";
import {
    getPaginatedVouchers,
    getVoucherById,
    createVoucher,
    updateVoucher,
    deleteVoucher,
    validateVoucher,
    getPaginatedPromotions,
    getActivePromotions,
    getPromotionById,
    createPromotion,
    updatePromotion,
    deletePromotion,
    getPaginatedMembers,
    getMemberSummary,
    registerMember,
    updateMember,
    adjustMemberPoints,
} from "@/controllers/crm.controller";

const crmRouter = Router();

// Voucher routes
crmRouter.get("/vouchers", getPaginatedVouchers);
crmRouter.post("/vouchers/validate", validateVoucher);
crmRouter.get("/vouchers/:id", getVoucherById);
crmRouter.post("/vouchers", createVoucher);
crmRouter.put("/vouchers/:id", updateVoucher);
crmRouter.delete("/vouchers/:id", deleteVoucher);

// Promotion routes
crmRouter.get("/promotions", getPaginatedPromotions);
crmRouter.get("/promotions/active", getActivePromotions);
crmRouter.get("/promotions/:id", getPromotionById);
crmRouter.post("/promotions", createPromotion);
crmRouter.put("/promotions/:id", updatePromotion);
crmRouter.delete("/promotions/:id", deletePromotion);

// Member routes
crmRouter.get("/members", getPaginatedMembers);
crmRouter.get("/members/summary", getMemberSummary);
crmRouter.post("/members/register", registerMember);
crmRouter.put("/members/:id", updateMember);
crmRouter.post("/members/:id/adjust-points", adjustMemberPoints);

export default crmRouter;
