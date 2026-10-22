import { db } from "./index";
import { sql } from "drizzle-orm";
import { execSync } from "child_process";

async function main() {
    console.log("Dropping all tables...");
    await db.execute(sql`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
    console.log("Dropped all tables.");

    console.log("Recreating schema tables...");
    execSync("npx drizzle-kit push --force", { stdio: "inherit" });
    console.log("Schema tables recreated successfully.");

    process.exit(0);
}

main().catch((err) => {
    console.error("Reset DB failed:", err);
    process.exit(1);
});
