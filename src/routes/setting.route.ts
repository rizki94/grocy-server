import { Router } from "express";
import { getSettings, updateSettings } from "../controllers/setting.controller";

const settingRouter = Router();

settingRouter.get("/", getSettings);
settingRouter.put("/", updateSettings);

export default settingRouter;
