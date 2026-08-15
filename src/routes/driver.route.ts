import { Router } from "express";
import {
    getDrivers,
    createDriver,
    updateDriver,
    deleteDriver,
} from "@/controllers/driver.controller";

export const driverRouter = Router();

driverRouter.get("/", getDrivers);
driverRouter.post("/", createDriver);
driverRouter.put("/:id", updateDriver);
driverRouter.delete("/:id", deleteDriver);
