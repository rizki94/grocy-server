import { Router } from "express";
import {
    getNotifications,
    getUnreadCount,
    markAsRead,
    markAllAsRead,
} from "@/controllers/notification.controller";

const notificationRouter = Router();

notificationRouter.get("/", getNotifications);
notificationRouter.get("/unread-count", getUnreadCount);
notificationRouter.put("/read-all", markAllAsRead);
notificationRouter.put("/:id/read", markAsRead);

export default notificationRouter;
