import { db } from "../db";
import { products, productDetails } from "../db/schemas";
import { asc, eq } from "drizzle-orm";

async function fixProductRatios() {
    console.log("=== Starting Product Details Ratio Fix ===");

    const allProducts = await db.select({ id: products.id, name: products.name }).from(products);
    console.log(`Found ${allProducts.length} products to check.`);

    let updatedCount = 0;

    for (const p of allProducts) {
        const details = await db
            .select()
            .from(productDetails)
            .where(eq(productDetails.productId, p.id))
            .orderBy(asc(productDetails.level));

        if (details.length === 0) continue;

        for (let i = 0; i < details.length; i++) {
            const d = details[i];
            let targetRatio = 1;

            if (i === 0) {
                targetRatio = 1;
            } else {
                const prevBase = Number(details[i - 1].baseRatio) || 1;
                const currBase = Number(d.baseRatio) || 1;
                targetRatio = Math.max(1, Math.round(prevBase / currBase));
                targetRatio = Math.min(32767, targetRatio);
            }

            if (d.ratio !== targetRatio) {
                await db
                    .update(productDetails)
                    .set({ ratio: targetRatio })
                    .where(eq(productDetails.id, d.id));
                updatedCount++;
            }
        }
    }

    console.log(`Successfully updated ratio for ${updatedCount} product details.`);
    console.log("=== Ratio Fix Complete ===");
}

fixProductRatios()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("❌ Failed to fix ratios:", err);
        process.exit(1);
    });
