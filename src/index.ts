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

app.use(pinoHttp({ logger }));

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
