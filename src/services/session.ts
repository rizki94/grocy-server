import session from "express-session";
import connectPgSimple from "connect-pg-simple";

const PgSessionStore = connectPgSimple(session);

export const sessionMiddleware = session({
    store: new PgSessionStore({
        conString: process.env.DB_URL,
        tableName: "sessions",
    }),
    secret: process.env.SESSION_SECRET || "secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 7,
    },
});
