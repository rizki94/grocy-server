import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schemas";
import "dotenv/config";

export const db = drizzle(process.env.DB_URL!, { schema });
