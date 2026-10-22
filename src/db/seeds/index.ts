import { db } from "..";
import { seedGlAccounts } from "./001_seed_gl_accounts";
import { seedAccountMappings } from "./002_seed_account_mappings";
import { seedAccounts } from "./003_seed_accounts";
import { seedSettings } from "./006_seed_settings";
import { seedDemoData } from "./004_seed_demo_data";

async function main() {
    console.log("Running seeds...");

    await seedGlAccounts(db);
    await seedAccountMappings(db);
    await seedAccounts(db);
    await seedSettings(db);
    await seedDemoData(db);

    console.log("Seeding done");
    process.exit(0);
}

main().catch((err) => {
    console.error("Seeding failed", err);
    process.exit(1);
});
