import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
    out: "./src/db/migrations",
    schema: "./src/db/schemas",
    dialect: "postgresql",
    dbCredentials: {
        url: process.env.DB_URL!,
    },
});
