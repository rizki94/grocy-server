import { db } from "../db";
import { sql } from "drizzle-orm";

async function fixStockLayers() {
    console.log("Fixing existing stock layers and movements unit cost...");

    await db.execute(sql`
        UPDATE stock_layers sl
        SET unit_cost = sl.unit_cost / td.base_ratio
        FROM stock_movements sm
        JOIN transaction_details td ON sm.transaction_id = td.transaction_id AND td.movement_type = 1
        WHERE sl.movement_id = sm.id
          AND td.base_ratio > 1
          AND sl.unit_cost > (td.unit_cost / td.base_ratio + 0.01);
    `);

    await db.execute(sql`
        UPDATE stock_movements sm
        SET unit_cost = sm.unit_cost / td.base_ratio
        FROM transaction_details td
        WHERE sm.transaction_id = td.transaction_id AND td.movement_type = 1
          AND td.base_ratio > 1
          AND sm.unit_cost > (td.unit_cost / td.base_ratio + 0.01);
    `);

    console.log("Fix completed successfully!");
    process.exit(0);
}

fixStockLayers().catch((err) => {
    console.error("Fix failed:", err);
    process.exit(1);
});
