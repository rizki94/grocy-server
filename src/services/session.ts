import session from "express-session";
import connectPgSimple from "connect-pg-simple";

const PgSessionStore = connectPgSimple(session);

const inactivityHours = Number(process.env.SESSION_INACTIVITY_HOURS) || 12;
const maxAgeMs = inactivityHours * 60 * 60 * 1000;

export const sessionMiddleware = session({
    store: new PgSessionStore({
        conString: process.env.DB_URL,
        tableName: "sessions",
        pruneSessionInterval: 60 * 15, // Prune expired sessions every 15 minutes
    }),
    secret: process.env.SESSION_SECRET || "secret-key",
    resave: false,
    saveUninitialized: false,
    rolling: true, // Sliding expiration: resets cookie maxAge and touches session on every active request
    cookie: {
        maxAge: maxAgeMs,
        httpOnly: true,
        sameSite: "lax",
    },
});
