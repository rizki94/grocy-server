import {
    createCustomer,
    getAllCustomers,
    getCustomerById,
    getCustomerCreditStatus,
    getPaginatedCustomers,
    updateCustomer,
    getActiveCustomers,
} from "@/controllers/customer.controller";
import { Router } from "express";

const customerRouter = Router();

customerRouter.get("/", getAllCustomers);
customerRouter.get("/active", getActiveCustomers);
customerRouter.get("/paginated", getPaginatedCustomers);
customerRouter.get("/:id/credit-status", getCustomerCreditStatus);
customerRouter.get("/:id", getCustomerById);
customerRouter.post("/", createCustomer);
customerRouter.put("/:id", updateCustomer);

export default customerRouter;
