import {
    createCustomer,
    getAllCustomers,
    getCustomerById,
    getPaginatedCustomers,
    updateCustomer,
    getActiveCustomers,
} from "@/controllers/customer.controller";
import { Router } from "express";

const customerRouter = Router();

customerRouter.get("/", getAllCustomers);
customerRouter.get("/active", getActiveCustomers);
customerRouter.get("/paginated", getPaginatedCustomers);
customerRouter.get("/:id", getCustomerById);
customerRouter.post("/", createCustomer);
customerRouter.put("/:id", updateCustomer);

export default customerRouter;
