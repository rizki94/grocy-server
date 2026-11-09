import { db } from "@/db";
import { productAttributes, productAttributeValues } from "@/db/schemas";

async function main() {
    const attrs = await db.select().from(productAttributes);
    console.log("Attributes:", JSON.stringify(attrs, null, 2));

    const sampleValues = await db.select().from(productAttributeValues).limit(10);
    console.log("Sample values:", JSON.stringify(sampleValues, null, 2));
    process.exit(0);
}

main().catch(console.error);

