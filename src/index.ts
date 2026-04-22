import "dotenv/config";
import express from "express";
import { route } from "./route";
import { corsMiddleware } from "./services/cors";
import { sessionMiddleware } from "./services/session";
import { passportMiddleware } from "./services/passport";
import { errorHandler } from "./middleware/error-handler";
import { notFound } from "./middleware/not-found";

import { logger } from "./logger";
import pinoHttp from "pino-http";

const app = express();
app.set("etag", false);

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

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(corsMiddleware);
app.use(sessionMiddleware);
app.use(passportMiddleware);


app.use("/api", route);
app.use("/uploads", express.static("uploads"));

app.use(notFound);
app.use(errorHandler);

app.listen(process.env.SERVER_PORT || 3001, () => {
    console.log(`🚀 Server running on port ${process.env.SERVER_PORT || 3001}`);
});
