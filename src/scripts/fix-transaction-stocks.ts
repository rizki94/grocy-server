import { db } from "../db";
import { products, productDetails, warehouses, stocks, transactionDetails } from "../db/schemas";
import { eq, and, sql } from "drizzle-orm";
import sqlServer from "mssql";
import dotenv from "dotenv";
dotenv.config();

const sqlConfig: sqlServer.config = {
    user: process.env.MSSQL_USER || "api",
    password: process.env.MSSQL_PASSWORD || "Hrd12345",
    database: process.env.MSSQL_DATABASE || "dbPrimaNusantara",
    server: process.env.MSSQL_HOST || "192.168.5.100",
    port: Number(process.env.MSSQL_PORT) || 1433,
    options: {
        encrypt: false,
        trustServerCertificate: true,
    },
};

async function fixTransactionStocks() {
    console.log("=== Starting Transaction Stock Recalculation ===");

    // 1. Fix movement_type in transaction_details (2 -> -1 for outward)
    console.log("1. Fixing movement_type in transaction_details...");
    const updatedMovement = await db.execute(sql`
        UPDATE transaction_details
        SET movement_type = -1
        WHERE movement_type = 2;
    `);
    console.log("   Updated outward movement_type to -1.");

    // 2. Connect to SQL Server and compute exact stock from D_Transaction: SUM(Ndc * Qty * Rat)
    console.log("\n2. Fetching exact stock per product & warehouse from SQL Server D_Transaction...");
    const pool = await sqlServer.connect(sqlConfig);

    const mssqlStockRes = await pool.request().query(`
        SELECT 
            RTRIM(LTRIM(PKey)) as sku,
            AccLoc as warehouseCode,
            SUM(Ndc * Qty * Rat) as totalBaseQty
        FROM D_Transaction
        WHERE PKey IS NOT NULL
        GROUP BY RTRIM(LTRIM(PKey)), AccLoc
    `);
    console.log(`   Fetched ${mssqlStockRes.recordset.length} product/warehouse stock records from SQL Server.`);
    await pool.close();

    // 3. Build warehouse map by code
    const allWarehouses = await db.select().from(warehouses);
    const warehouseMapByCode: Record<string, string> = {};
    for (const w of allWarehouses) {
        if (w.code) warehouseMapByCode[w.code.trim()] = w.id;
    }
    const defaultWarehouse = allWarehouses.find(w => w.isDefault) || allWarehouses[0];

    // 4. Build product map by sku
    const allDetails = await db.select({
        productId: productDetails.productId,
        skuId: productDetails.skuId,
    }).from(productDetails);

    const productMapBySku: Record<string, string> = {};
    for (const d of allDetails) {
        const baseSku = d.skuId.replace(/-L\d+$/, '').trim();
        if (!productMapBySku[baseSku]) {
            productMapBySku[baseSku] = d.productId;
        }
    }

    // 5. Aggregate stocks in base units per (productId, warehouseId)
    const stockMap = new Map<string, { productId: string; warehouseId: string; qty: number }>();

    for (const r of mssqlStockRes.recordset) {
        const sku = (r.sku || "").trim();
        const productId = productMapBySku[sku];
        if (!productId) continue;

        const whCode = String(r.warehouseCode || "").trim();
        const warehouseId = warehouseMapByCode[whCode] || defaultWarehouse.id;
        const baseQty = Number(r.totalBaseQty) || 0;

        const key = `${productId}_${warehouseId}`;
        const existing = stockMap.get(key);
        if (existing) {
            existing.qty += baseQty;
        } else {
            stockMap.set(key, {
                productId,
                warehouseId,
                qty: baseQty,
            });
        }
    }

    // 6. Update or insert into stocks table in Postgres
    console.log("\n3. Synchronizing stocks table in PostgreSQL...");
    let updatedCount = 0;
    let insertedCount = 0;

    for (const entry of stockMap.values()) {
        const netQty = Math.max(0, Math.round(entry.qty * 100) / 100);

        const [existing] = await db
            .select()
            .from(stocks)
            .where(
                and(
                    eq(stocks.productId, entry.productId),
                    eq(stocks.warehouseId, entry.warehouseId),
                ),
            )
            .limit(1);

        if (existing) {
            await db
                .update(stocks)
                .set({ qty: netQty })
                .where(eq(stocks.id, existing.id));
            updatedCount++;
        } else {
            await db.insert(stocks).values({
                productId: entry.productId,
                warehouseId: entry.warehouseId,
                qty: netQty,
            });
            insertedCount++;
        }
    }

    console.log(`   Updated ${updatedCount} existing stock records.`);
    console.log(`   Inserted ${insertedCount} new stock records.`);

    // 7. Verify Vadco and Aluminium Foil in Postgres
    console.log("\n=== Verifying Sample Stocks in PostgreSQL ===");
    const verification = await db.execute(sql`
        SELECT p.name, w.name as warehouse, s.qty
        FROM stocks s
        JOIN products p ON s.product_id = p.id
        LEFT JOIN warehouses w ON s.warehouse_id = w.id
        WHERE p.name LIKE '%VADCO%' OR p.name LIKE '%ALUMINIUM FOIL BULAT 100%'
        ORDER BY p.name;
    `);
    console.table(verification.rows);

    console.log("=== Stock Recalculation Complete ===");
    process.exit(0);
}

fixTransactionStocks().catch((err) => {
    console.error("❌ Failed to fix transaction stocks:", err);
    process.exit(1);
});
