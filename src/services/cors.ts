import "dotenv/config";
import cors from "cors";

export const corsMiddleware = cors({
    credentials: true,
    origin: process.env.CLIENT_URL,
});
