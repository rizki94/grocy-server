import { db } from "./index";
import { sql } from "drizzle-orm";

async function main() {
    console.log("Dropping all tables...");
    await db.execute(sql`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
    console.log("Dropped all tables.");
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
