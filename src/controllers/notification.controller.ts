import { db } from "@/db";
import { desc, eq, and, sql } from "drizzle-orm";
import { Request, Response } from "express";
import { notifications } from "@/db/schemas";
import { sendRealtimeNotification } from "@/services/socket.service";

// Helper function to create notification from other routes/services
export async function createNotification(data: {
    userId: string;
    type: string;
    title: string;
    body: string;
    data?: any;
    actorId?: string;
    entityType?: string;
    entityId?: string;
}) {
    const [notification] = await db
        .insert(notifications)
        .values({
            userId: data.userId,
            type: data.type,
            title: data.title,
            body: data.body,
            data: data.data || null,
            actorId: data.actorId || null,
            entityType: data.entityType || null,
            entityId: data.entityId || null,
        })
        .returning();

    // Send via socket.io
    sendRealtimeNotification(data.userId, notification);
    return notification;
}

export const getNotifications = async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const isReadFilter = req.query.isRead === "true" ? true : req.query.isRead === "false" ? false : undefined;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;

    try {
        const conditions = [eq(notifications.userId, userId)];
        if (isReadFilter !== undefined) {
            conditions.push(eq(notifications.isRead, isReadFilter));
        }

        const data = await db
            .select()
            .from(notifications)
            .where(and(...conditions))
            .orderBy(desc(notifications.createdAt))
            .limit(limit)
            .offset(offset);

        res.status(200).json(data);
    } catch (error) {
        console.error("Error fetching notifications:", error);
        res.status(500).json({ error: "Failed to fetch notifications" });
    }
};

export const getUnreadCount = async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    try {
        const [result] = await db
            .select({ count: sql<number>`count(*)` })
            .from(notifications)
            .where(
                and(
                    eq(notifications.userId, userId),
                    eq(notifications.isRead, false)
                )
            );

        res.status(200).json({ count: Number(result?.count || 0) });
    } catch (error) {
        console.error("Error fetching unread count:", error);
        res.status(500).json({ error: "Failed to fetch unread count" });
    }
};

export const markAsRead = async (req: Request, res: Response) => {
    const userId = req.user?.id;
    const { id } = req.params;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    try {
        const [updated] = await db
            .update(notifications)
            .set({
                isRead: true,
                readAt: new Date(),
            })
            .where(
                and(
                    eq(notifications.id, id),
                    eq(notifications.userId, userId)
                )
            )
            .returning();

        if (!updated) {
            return res.status(404).json({ error: "Notification not found or unauthorized" });
        }

        res.status(200).json(updated);
    } catch (error) {
        console.error("Error marking notification as read:", error);
        res.status(500).json({ error: "Failed to update notification" });
    }
};

export const markAllAsRead = async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    try {
        const updated = await db
            .update(notifications)
            .set({
                isRead: true,
                readAt: new Date(),
            })
            .where(
                and(
                    eq(notifications.userId, userId),
                    eq(notifications.isRead, false)
                )
            )
            .returning();

        res.status(200).json({ count: updated.length });
    } catch (error) {
        console.error("Error marking all notifications as read:", error);
        res.status(500).json({ error: "Failed to update notifications" });
    }
};
