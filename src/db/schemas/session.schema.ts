import { json, timestamp, index, pgTable, text } from "drizzle-orm/pg-core";

export const sessions = pgTable(
    "sessions",
    {
        sid: text("sid").primaryKey(),
        sess: json("sess").notNull(),
        expire: timestamp("expire", { withTimezone: false }).notNull(),
    },
    (table) => [index("sessions_expire_idx").on(table.expire)]
);
