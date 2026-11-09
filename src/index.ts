import "dotenv/config";
import express from "express";
import { route } from "./route";
import { corsMiddleware } from "./services/cors";
import { sessionMiddleware } from "./services/session";
import { passportMiddleware } from "./services/passport";
import { errorHandler } from "./middleware/error-handler";
import { notFound } from "./middleware/not-found";
import { branchMiddleware } from "./middleware/branch";

import { logger } from "./logger";
import pinoHttp from "pino-http";
import { db } from "./db";
import { sql } from "drizzle-orm";

const app = express();
app.set("etag", false);
app.set("trust proxy", 1);

app.use(
    pinoHttp({
        logger,
        customProps: (req: any) => {
            const fullUrl = req.originalUrl || req.url || "";
            let table = "system";

            // Matches /api/{resource}/...
            const apiMatch = fullUrl.match(/\/api\/([^\/\?]+)/);
            if (apiMatch) {
                table = apiMatch[1];
            }

            return {
                action: (req.method || "GET").toLowerCase(),
                table,
                userId: req.user?.id,
            };
        },
        customSuccessMessage: (req, res) =>
            `${req.method} ${req.originalUrl || req.url} ${res.statusCode}`,
        customErrorMessage: (req, res, err) =>
            `${req.method} ${req.originalUrl || req.url} ${res.statusCode} - ${err.message}`,
        serializers: {
            req: () => undefined,
            res: () => undefined,
        },
    })
);

app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(express.json({ limit: "50mb" }));
app.use(corsMiddleware);
app.use(sessionMiddleware);
app.use(passportMiddleware);
app.use(branchMiddleware);

app.get("/healthz", async (_req, res) => {
    try {
        await db.execute(sql`SELECT 1`);
        res.status(200).json({ status: "healthy", timestamp: new Date().toISOString() });
    } catch (err: any) {
        res.status(503).json({ status: "unhealthy", error: err.message });
    }
});

app.use("/api", route);
app.use("/uploads", express.static("uploads"));

app.use(notFound);
app.use(errorHandler);

app.listen(process.env.SERVER_PORT || 3001, () => {
    console.log(`🚀 Server running on port ${process.env.SERVER_PORT || 3001}`);
});
