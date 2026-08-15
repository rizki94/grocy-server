import { Router } from "express";
import {
    getTrucks,
    createTruck,
    updateTruck,
    deleteTruck,
} from "@/controllers/truck.controller";

export const truckRouter = Router();

truckRouter.get("/", getTrucks);
truckRouter.post("/", createTruck);
truckRouter.put("/:id", updateTruck);
truckRouter.delete("/:id", deleteTruck);
