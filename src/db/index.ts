import { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schemas";
import "dotenv/config";
import { getTenantDb } from "@/services/tenant.service";

export const db: NodePgDatabase<typeof schema> = new Proxy(
    {} as NodePgDatabase<typeof schema>,
    {
        get(_target, prop, receiver) {
            const activeDb = getTenantDb();
            const val = Reflect.get(activeDb, prop, receiver);
            if (typeof val === "function") {
                return val.bind(activeDb);
            }
            return val;
        },
    },
);
