import { boolean, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./user.schema";

export const notifications = pgTable("notifications", {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // e.g. 'new_message', 'out_of_stock', 'new_transaction'
    title: text("title").notNull(),
    body: text("body").notNull(),
    data: jsonb("data"), // flexible JSON payload
    isRead: boolean("is_read").notNull().default(false),
    readAt: timestamp("read_at"),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }), // user who triggered this
    entityType: text("entity_type"), // e.g. 'transaction', 'product', 'message'
    entityId: uuid("entity_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const notificationsRelations = relations(notifications, ({ one }) => ({
    user: one(users, {
        fields: [notifications.userId],
        references: [users.id],
        relationName: "notification_recipient",
    }),
    actor: one(users, {
        fields: [notifications.actorId],
        references: [users.id],
        relationName: "notification_actor",
    }),
}));
