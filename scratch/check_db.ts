import { db } from "../src/db";
import { productDetails } from "../src/db/schemas";

async function checkDetails() {
    const details = await db.select().from(productDetails).limit(10);
    console.log(JSON.stringify(details, null, 2));
    process.exit(0);
}

checkDetails();
