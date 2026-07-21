import {
    boolean,
    integer,
    jsonb,
    pgEnum,
    pgTable,
    text,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./user.schema";

export const conversationTypeEnum = pgEnum("conversation_type", [
    "private",
    "group",
]);

export const messageTypeEnum = pgEnum("message_type", [
    "text",
    "image",
    "video",
    "audio",
    "document",
    "event_share",
]);

export const conversations = pgTable("conversations", {
    id: uuid("id").defaultRandom().primaryKey(),
    type: conversationTypeEnum("type").notNull(),
    name: text("name"),
    avatar: text("avatar"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
        .defaultNow()
        .notNull()
        .$onUpdate(() => new Date()),
});

export const conversationParticipants = pgTable("conversation_participants", {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
        .notNull()
        .references(() => conversations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    isAdmin: boolean("is_admin").notNull().default(false),
    joinedAt: timestamp("joined_at").defaultNow().notNull(),
    lastReadAt: timestamp("last_read_at"),
});

export const messages = pgTable("messages", {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
        .notNull()
        .references(() => conversations.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id")
        .notNull()
        .references(() => users.id),
    type: messageTypeEnum("type").notNull().default("text"),
    content: text("content"),
    mediaUrl: text("media_url"),
    mediaType: text("media_type"),
    mediaSize: integer("media_size"),
    mediaName: text("media_name"),
    eventType: text("event_type"),
    eventId: uuid("event_id"),
    replyToId: uuid("reply_to_id"),
    isDeleted: boolean("is_deleted").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
        .defaultNow()
        .notNull()
        .$onUpdate(() => new Date()),
});

export const messageReads = pgTable("message_reads", {
    id: uuid("id").defaultRandom().primaryKey(),
    messageId: uuid("message_id")
        .notNull()
        .references(() => messages.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at").defaultNow().notNull(),
});

// Relations
export const conversationsRelations = relations(
    conversations,
    ({ many }) => ({
        participants: many(conversationParticipants),
        messages: many(messages),
    })
);

export const conversationParticipantsRelations = relations(
    conversationParticipants,
    ({ one }) => ({
        conversation: one(conversations, {
            fields: [conversationParticipants.conversationId],
            references: [conversations.id],
        }),
        user: one(users, {
            fields: [conversationParticipants.userId],
            references: [users.id],
        }),
    })
);

export const messagesRelations = relations(messages, ({ one, many }) => ({
    conversation: one(conversations, {
        fields: [messages.conversationId],
        references: [conversations.id],
    }),
    sender: one(users, {
        fields: [messages.senderId],
        references: [users.id],
    }),
    replyTo: one(messages, {
        fields: [messages.replyToId],
        references: [messages.id],
        relationName: "reply_chain",
    }),
    replies: many(messages, { relationName: "reply_chain" }),
    reads: many(messageReads),
}));

export const messageReadsRelations = relations(messageReads, ({ one }) => ({
    message: one(messages, {
        fields: [messageReads.messageId],
        references: [messages.id],
    }),
    user: one(users, {
        fields: [messageReads.userId],
        references: [users.id],
    }),
}));
