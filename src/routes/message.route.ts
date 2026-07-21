import { Router } from "express";
import {
    getConversations,
    createConversation,
    getMessages,
    sendMessage,
    markAsRead,
    editMessage,
    deleteMessage,
    addParticipants,
    removeParticipant,
} from "@/controllers/message.controller";

const messageRouter = Router();

messageRouter.get("/conversations", getConversations);
messageRouter.post("/conversations", createConversation);
messageRouter.get("/conversations/:conversationId/messages", getMessages);
messageRouter.post("/conversations/:conversationId/messages", sendMessage);
messageRouter.post("/conversations/:conversationId/read", markAsRead);
messageRouter.put("/conversations/:conversationId/messages/:messageId", editMessage);
messageRouter.delete("/conversations/:conversationId/messages/:messageId", deleteMessage);
messageRouter.post("/conversations/:conversationId/participants", addParticipants);
messageRouter.delete("/conversations/:conversationId/participants/:targetUserId", removeParticipant);

export default messageRouter;
