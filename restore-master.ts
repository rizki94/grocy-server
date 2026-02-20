import "dotenv/config";
import { db } from "./src/db";
import {
    products,
    productDetails,
    productUnits,
    taxes,
} from "./src/db/schemas";
import { eq } from "drizzle-orm";

async function restoreMaster() {
    try {
        const allProducts = await db.select().from(products);
        if (allProducts.length === 0) {
            console.log("No products found.");
            return;
        }

        const p = allProducts[0];

        // 1. Create a Unit if none exists
        let unit = await db
            .select()
            .from(productUnits)
            .limit(1)
            .then((r) => r[0]);
        if (!unit) {
            console.log("Creating default unit 'Pcs'...");
            const [newUnit] = await db
                .insert(productUnits)
                .values({
                    name: "Pieces",
                    abbreviation: "Pcs",
                    accountId: p.accountId,
                })
                .returning();
            unit = newUnit;
        }

        // 2. Create Product Details for the existing product
        const details = await db
            .select()
            .from(productDetails)
            .where(eq(productDetails.productId, p.id));
        if (details.length === 0) {
            console.log(`Creating default details for ${p.name}...`);
            await db.insert(productDetails).values({
                productId: p.id,
                unitId: unit.id,
                skuId: "SKU001",
                barcode: "123456789",
                level: 1,
                ratio: 1,
                baseRatio: 1,
                cost: 1000,
                isSellable: true,
                isDefault: true,
            });
        }

        console.log("Master data restoration complete.");
    } catch (err) {
        console.error("Restoration failed:", err);
    } finally {
        process.exit();
    }
}

restoreMaster();
