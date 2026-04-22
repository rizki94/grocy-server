import { Router } from "express";
import { getAllPaymentMethods, createPaymentMethod, updatePaymentMethod, deletePaymentMethod } from "@/controllers/payment-method.controller";

const router = Router();

router.get("/", getAllPaymentMethods);
router.post("/", createPaymentMethod);
router.put("/:id", updatePaymentMethod);
router.delete("/:id", deletePaymentMethod);

export default router;
