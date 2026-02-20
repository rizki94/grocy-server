import { db } from "..";
import { seedGlAccounts } from "./001_seed_gl_accounts";
import { seedAccountMappings } from "./002_seed_account_mappings";
import { seedAccounts } from "./003_seed_accounts";

async function main() {
    console.log("Running seeds...");

    await seedGlAccounts(db);
    await seedAccountMappings(db);
    await seedAccounts(db);

    console.log("Seeding done");
    process.exit(0);
}

main().catch((err) => {
    console.error("Seeding failed", err);
    process.exit(1);
});
