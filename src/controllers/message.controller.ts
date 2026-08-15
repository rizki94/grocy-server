import { db } from "@/db";
import { and, eq, or, ne, desc, asc, inArray, sql } from "drizzle-orm";
import { Request, Response } from "express";
import {
    conversations,
    conversationParticipants,
    messages,
    users,
    messageReads
} from "@/db/schemas";
import {
    sendRealtimeMessage,
    updateRealtimeConversation
} from "@/services/socket.service";
import { createNotification } from "./notification.controller";

// Get user's conversation list
export const getConversations = async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    try {
        // Find all conversations where the current user is a participant
        const myParticipations = await db
            .select({ conversationId: conversationParticipants.conversationId })
            .from(conversationParticipants)
            .where(eq(conversationParticipants.userId, userId));

        if (myParticipations.length === 0) {
            return res.status(200).json([]);
        }

        const convIds = myParticipations.map((p) => p.conversationId);

        // Fetch conversations and participants
        const convList = await db
            .select({
                id: conversations.id,
                type: conversations.type,
                name: conversations.name,
                avatar: conversations.avatar,
                createdAt: conversations.createdAt,
                updatedAt: conversations.updatedAt,
            })
            .from(conversations)
            .where(inArray(conversations.id, convIds))
            .orderBy(desc(conversations.updatedAt));

        // For each conversation, fetch all participants and last message
        const result = [];
        for (const conv of convList) {
            // Participants
            const participants = await db
                .select({
                    id: users.id,
                    username: users.username,
                    displayName: users.displayName,
                    avatar: users.avatar,
                    isAdmin: conversationParticipants.isAdmin,
                    joinedAt: conversationParticipants.joinedAt,
                    lastReadAt: conversationParticipants.lastReadAt,
                })
                .from(conversationParticipants)
                .innerJoin(users, eq(conversationParticipants.userId, users.id))
                .where(eq(conversationParticipants.conversationId, conv.id));

            // Last message
            const [lastMsg] = await db
                .select({
                    id: messages.id,
                    content: messages.content,
                    type: messages.type,
                    senderId: messages.senderId,
                    createdAt: messages.createdAt,
                    isDeleted: messages.isDeleted,
                    mediaUrl: messages.mediaUrl,
                })
                .from(messages)
                .where(eq(messages.conversationId, conv.id))
                .orderBy(desc(messages.createdAt))
                .limit(1);

            // Unread count: messages created after current user's lastReadAt
            const myParticipant = participants.find((p) => p.id === userId);
            const lastRead = myParticipant?.lastReadAt;

            let unreadCount = 0;
            if (lastRead) {
                const [countRes] = await db
                    .select({ count: sql<number>`count(*)` })
                    .from(messages)
                    .where(
                        and(
                            eq(messages.conversationId, conv.id),
                            sql`${messages.createdAt} > ${lastRead}`,
                            ne(messages.senderId, userId)
                        )
                    );
                unreadCount = Number(countRes?.count || 0);
            } else {
                // If lastRead is null, count all messages sent by others
                const [countRes] = await db
                    .select({ count: sql<number>`count(*)` })
                    .from(messages)
                    .where(
                        and(
                            eq(messages.conversationId, conv.id),
                            ne(messages.senderId, userId)
                        )
                    );
                unreadCount = Number(countRes?.count || 0);
            }

            result.push({
                ...conv,
                participants,
                lastMessage: lastMsg || null,
                unreadCount,
            });
        }

        res.status(200).json(result);
    } catch (error) {
        console.error("Error getting conversations:", error);
        res.status(500).json({ error: "Failed to get conversations" });
    }
};

// Create a new conversation (private or group)
export const createConversation = async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { type, participantIds, name, avatar } = req.body; // participantIds does NOT include current user

    if (!type || !["private", "group"].includes(type)) {
        return res.status(400).json({ error: "Invalid conversation type" });
    }

    try {
        if (type === "private") {
            const otherUserId = participantIds[0];
            if (!otherUserId) return res.status(400).json({ error: "Participant required" });

            // Check if private conversation already exists
            const existing = await db.execute(sql`
                SELECT c.id 
                FROM conversations c
                JOIN conversation_participants cp1 ON c.id = cp1.conversation_id AND cp1.user_id = ${userId}
                JOIN conversation_participants cp2 ON c.id = cp2.conversation_id AND cp2.user_id = ${otherUserId}
                WHERE c.type = 'private'
                LIMIT 1
            `);

            if (existing.rows.length > 0) {
                const existingConvId = existing.rows[0].id as string;
                // Fetch details of this conversation
                const [conv] = await db
                    .select()
                    .from(conversations)
                    .where(eq(conversations.id, existingConvId))
                    .limit(1);

                return res.status(200).json(conv);
            }

            // Create new private conversation
            const [newConv] = await db
                .insert(conversations)
                .values({ type: "private" })
                .returning();

            // Add participants
            await db.insert(conversationParticipants).values([
                { conversationId: newConv.id, userId: userId, lastReadAt: new Date() },
                { conversationId: newConv.id, userId: otherUserId, lastReadAt: new Date() },
            ]);

            // Notify real-time
            updateRealtimeConversation([userId, otherUserId], "conversation:new", newConv);

            return res.status(201).json(newConv);
        } else {
            // Group conversation
            if (!name) return res.status(400).json({ error: "Group name required" });

            const [newConv] = await db
                .insert(conversations)
                .values({
                    type: "group",
                    name,
                    avatar: avatar || null,
                })
                .returning();

            // Add creator as Admin, and others
            const participantValues = [
                { conversationId: newConv.id, userId: userId, isAdmin: true, lastReadAt: new Date() },
                ...(participantIds || []).map((pId: string) => ({
                    conversationId: newConv.id,
                    userId: pId,
                    isAdmin: false,
                    lastReadAt: new Date(),
                })),
            ];

            await db.insert(conversationParticipants).values(participantValues);

            const allUserIds = [userId, ...(participantIds || [])];
            updateRealtimeConversation(allUserIds, "conversation:new", newConv);

            return res.status(201).json(newConv);
        }
    } catch (error) {
        console.error("Error creating conversation:", error);
        res.status(500).json({ error: "Failed to create conversation" });
    }
};

// Fetch conversation messages
export const getMessages = async (req: Request, res: Response) => {
    const userId = req.user?.id;
    const { conversationId } = req.params;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    try {
        // Verify user is participant
        const [isParticipant] = await db
            .select()
            .from(conversationParticipants)
            .where(
                and(
                    eq(conversationParticipants.conversationId, conversationId),
                    eq(conversationParticipants.userId, userId)
                )
            )
            .limit(1);

        if (!isParticipant) {
            return res.status(403).json({ error: "Not a participant in this conversation" });
        }

        const data = await db
            .select({
                id: messages.id,
                conversationId: messages.conversationId,
                senderId: messages.senderId,
                senderUsername: users.username,
                senderDisplayName: users.displayName,
                senderAvatar: users.avatar,
                type: messages.type,
                content: messages.content,
                mediaUrl: messages.mediaUrl,
                mediaType: messages.mediaType,
                mediaSize: messages.mediaSize,
                mediaName: messages.mediaName,
                eventType: messages.eventType,
                eventId: messages.eventId,
                replyToId: messages.replyToId,
                isDeleted: messages.isDeleted,
                createdAt: messages.createdAt,
                updatedAt: messages.updatedAt,
            })
            .from(messages)
            .innerJoin(users, eq(messages.senderId, users.id))
            .where(eq(messages.conversationId, conversationId))
            .orderBy(desc(messages.createdAt))
            .limit(limit)
            .offset(offset);

        // Reverse to display chronologically in UI
        res.status(200).json(data.reverse());
    } catch (error) {
        console.error("Error fetching messages:", error);
        res.status(500).json({ error: "Failed to fetch messages" });
    }
};

// Send message
export const sendMessage = async (req: Request, res: Response) => {
    const userId = req.user?.id;
    const username = req.user?.username;
    const { conversationId } = req.params;
    const {
        content,
        type = "text",
        mediaUrl,
        mediaType,
        mediaSize,
        mediaName,
        eventType,
        eventId,
        replyToId
    } = req.body;

    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    try {
        // Verify user is participant
        const [isParticipant] = await db
            .select()
            .from(conversationParticipants)
            .where(
                and(
                    eq(conversationParticipants.conversationId, conversationId),
                    eq(conversationParticipants.userId, userId)
                )
            )
            .limit(1);

        if (!isParticipant) {
            return res.status(403).json({ error: "Not a participant in this conversation" });
        }

        // Insert message
        const [newMsg] = await db
            .insert(messages)
            .values({
                conversationId,
                senderId: userId,
                type,
                content,
                mediaUrl,
                mediaType,
                mediaSize,
                mediaName,
                eventType,
                eventId,
                replyToId,
            })
            .returning();

        // Update conversation's updatedAt
        await db
            .update(conversations)
            .set({ updatedAt: new Date() })
            .where(eq(conversations.id, conversationId));

        // Format message with sender details
        const formattedMsg = {
            ...newMsg,
            senderUsername: username,
            senderDisplayName: (req.user as any)?.displayName,
            senderAvatar: (req.user as any)?.avatar,
        };

        // Realtime broadcast to conversation room
        sendRealtimeMessage(conversationId, formattedMsg);

        // Update lastReadAt for the sender automatically
        await db
            .update(conversationParticipants)
            .set({ lastReadAt: new Date() })
            .where(
                and(
                    eq(conversationParticipants.conversationId, conversationId),
                    eq(conversationParticipants.userId, userId)
                )
            );

        // Fetch other participants to notify them
        const otherParticipants = await db
            .select({
                userId: conversationParticipants.userId,
                username: users.username,
            })
            .from(conversationParticipants)
            .innerJoin(users, eq(conversationParticipants.userId, users.id))
            .where(
                and(
                    eq(conversationParticipants.conversationId, conversationId),
                    ne(conversationParticipants.userId, userId)
                )
            );

        const convInfo = await db
            .select()
            .from(conversations)
            .where(eq(conversations.id, conversationId))
            .limit(1);

        const isGroup = convInfo[0]?.type === "group";
        const groupName = convInfo[0]?.name;

        // Trigger push notifications for other participants
        for (const participant of otherParticipants) {
            let title = isGroup ? `${groupName}` : `${username}`;
            let body = isGroup ? `${username}: ` : "";

            if (type === "text") {
                body += content || "";
            } else if (type === "image") {
                body += "📷 Photo";
            } else if (type === "video") {
                body += "🎥 Video";
            } else if (type === "audio") {
                body += "🎵 Audio message";
            } else if (type === "document") {
                body += `📄 Document: ${mediaName || "file"}`;
            } else if (type === "event_share") {
                body += `🔗 Shared an event: ${eventType}`;
            }

            await createNotification({
                userId: participant.userId,
                type: "new_message",
                title,
                body,
                data: {
                    conversationId,
                    messageId: newMsg.id,
                    senderUsername: username,
                    isGroup,
                },
                actorId: userId,
                entityType: "message",
                entityId: newMsg.id,
            });
        }

        // Notify user lists to refresh conversation list snippet
        const allUserIds = [userId, ...otherParticipants.map((p) => p.userId)];
        updateRealtimeConversation(allUserIds, "conversation:updated", {
            conversationId,
            lastMessage: formattedMsg,
        });

        res.status(201).json(formattedMsg);
    } catch (error) {
        console.error("Error sending message:", error);
        res.status(500).json({ error: "Failed to send message" });
    }
};

// Mark conversation as read
export const markAsRead = async (req: Request, res: Response) => {
    const userId = req.user?.id;
    const { conversationId } = req.params;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    try {
        await db
            .update(conversationParticipants)
            .set({ lastReadAt: new Date() })
            .where(
                and(
                    eq(conversationParticipants.conversationId, conversationId),
                    eq(conversationParticipants.userId, userId)
                )
            );

        res.status(200).json({ success: true });
    } catch (error) {
        console.error("Error marking conversation as read:", error);
        res.status(500).json({ error: "Failed to mark as read" });
    }
};

// Edit message
export const editMessage = async (req: Request, res: Response) => {
    const userId = req.user?.id;
    const { conversationId, messageId } = req.params;
    const { content } = req.body;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    try {
        const [updatedMsg] = await db
            .update(messages)
            .set({
                content,
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(messages.id, messageId),
                    eq(messages.conversationId, conversationId),
                    eq(messages.senderId, userId)
                )
            )
            .returning();

        if (!updatedMsg) {
            return res.status(404).json({ error: "Message not found or not own message" });
        }

        // Format message with sender details
        const formattedMsg = {
            ...updatedMsg,
            senderUsername: req.user?.username,
        };

        // Notify socket
        sendRealtimeMessage(conversationId, formattedMsg);

        res.status(200).json(formattedMsg);
    } catch (error) {
        console.error("Error editing message:", error);
        res.status(500).json({ error: "Failed to edit message" });
    }
};

// Delete (soft delete) message
export const deleteMessage = async (req: Request, res: Response) => {
    const userId = req.user?.id;
    const { conversationId, messageId } = req.params;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    try {
        const [deletedMsg] = await db
            .update(messages)
            .set({
                isDeleted: true,
                content: "This message was deleted",
                mediaUrl: null,
                mediaType: null,
                mediaSize: null,
                mediaName: null,
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(messages.id, messageId),
                    eq(messages.conversationId, conversationId),
                    eq(messages.senderId, userId)
                )
            )
            .returning();

        if (!deletedMsg) {
            return res.status(404).json({ error: "Message not found or not own message" });
        }

        // Format message with sender details
        const formattedMsg = {
            ...deletedMsg,
            senderUsername: req.user?.username,
        };

        // Notify socket
        sendRealtimeMessage(conversationId, formattedMsg);

        res.status(200).json(formattedMsg);
    } catch (error) {
        console.error("Error deleting message:", error);
        res.status(500).json({ error: "Failed to delete message" });
    }
};

// Add participants to group
export const addParticipants = async (req: Request, res: Response) => {
    const userId = req.user?.id;
    const { conversationId } = req.params;
    const { participantIds } = req.body; // Array of userIds to add

    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!participantIds || !participantIds.length) {
        return res.status(400).json({ error: "Participant ids required" });
    }

    try {
        // Check if group admin
        const [myPart] = await db
            .select()
            .from(conversationParticipants)
            .where(
                and(
                    eq(conversationParticipants.conversationId, conversationId),
                    eq(conversationParticipants.userId, userId)
                )
            )
            .limit(1);

        if (!myPart || !myPart.isAdmin) {
            return res.status(403).json({ error: "Only group admins can add participants" });
        }

        // Add participants
        const values = participantIds.map((pId: string) => ({
            conversationId,
            userId: pId,
            isAdmin: false,
            lastReadAt: new Date(),
        }));

        await db.insert(conversationParticipants).values(values);

        // Fetch complete updated participants
        const allParticipants = await db
            .select({ userId: conversationParticipants.userId })
            .from(conversationParticipants)
            .where(eq(conversationParticipants.conversationId, conversationId));

        const allUserIds = allParticipants.map((p) => p.userId);
        updateRealtimeConversation(allUserIds, "conversation:updated_members", { conversationId });

        res.status(200).json({ success: true });
    } catch (error) {
        console.error("Error adding participants:", error);
        res.status(500).json({ error: "Failed to add participants" });
    }
};

// Remove participant from group
export const removeParticipant = async (req: Request, res: Response) => {
    const userId = req.user?.id;
    const { conversationId, targetUserId } = req.params;

    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    try {
        // Check if group admin OR target user is leaving their own group
        const [myPart] = await db
            .select()
            .from(conversationParticipants)
            .where(
                and(
                    eq(conversationParticipants.conversationId, conversationId),
                    eq(conversationParticipants.userId, userId)
                )
            )
            .limit(1);

        const isSelfLeaving = userId === targetUserId;

        if (!myPart || (!myPart.isAdmin && !isSelfLeaving)) {
            return res.status(403).json({ error: "Only group admins can remove participants" });
        }

        await db
            .delete(conversationParticipants)
            .where(
                and(
                    eq(conversationParticipants.conversationId, conversationId),
                    eq(conversationParticipants.userId, targetUserId)
                )
            );

        // Fetch remaining participants
        const allParticipants = await db
            .select({ userId: conversationParticipants.userId })
            .from(conversationParticipants)
            .where(eq(conversationParticipants.conversationId, conversationId));

        const allUserIds = [targetUserId, ...allParticipants.map((p) => p.userId)];
        updateRealtimeConversation(allUserIds, "conversation:updated_members", { conversationId });

        res.status(200).json({ success: true });
    } catch (error) {
        console.error("Error removing participant:", error);
        res.status(500).json({ error: "Failed to remove participant" });
    }
};

// Get total unread message count for badge across all conversations
export const getTotalUnreadCount = async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    try {
        const myParticipations = await db
            .select({
                conversationId: conversationParticipants.conversationId,
                lastReadAt: conversationParticipants.lastReadAt,
            })
            .from(conversationParticipants)
            .where(eq(conversationParticipants.userId, userId));

        if (myParticipations.length === 0) {
            return res.status(200).json({ unreadCount: 0 });
        }

        let totalUnread = 0;
        for (const p of myParticipations) {
            const lastRead = p.lastReadAt;
            let countRes;
            if (lastRead) {
                [countRes] = await db
                    .select({ count: sql<number>`count(*)` })
                    .from(messages)
                    .where(
                        and(
                            eq(messages.conversationId, p.conversationId),
                            sql`${messages.createdAt} > ${lastRead}`,
                            ne(messages.senderId, userId)
                        )
                    );
            } else {
                [countRes] = await db
                    .select({ count: sql<number>`count(*)` })
                    .from(messages)
                    .where(
                        and(
                            eq(messages.conversationId, p.conversationId),
                            ne(messages.senderId, userId)
                        )
                    );
            }
            totalUnread += Number(countRes?.count || 0);
        }

        res.status(200).json({ unreadCount: totalUnread });
    } catch (error) {
        console.error("Error getting total unread count:", error);
        res.status(500).json({ error: "Failed to get unread count" });
    }
};

// Update group conversation name or avatar
export const updateGroupDetails = async (req: Request, res: Response) => {
    const userId = req.user?.id;
    const { conversationId } = req.params;
    const { name, avatar } = req.body;

    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    try {
        const updateData: any = {};
        if (name !== undefined) updateData.name = name;
        if (avatar !== undefined) updateData.avatar = avatar;

        await db
            .update(conversations)
            .set(updateData)
            .where(eq(conversations.id, conversationId));

        const allParticipants = await db
            .select({ userId: conversationParticipants.userId })
            .from(conversationParticipants)
            .where(eq(conversationParticipants.conversationId, conversationId));

        const allUserIds = allParticipants.map((p) => p.userId);
        updateRealtimeConversation(allUserIds, "conversation:updated", { conversationId, ...updateData });

        res.status(200).json({ success: true });
    } catch (error) {
        console.error("Error updating group details:", error);
        res.status(500).json({ error: "Failed to update group" });
    }
};
