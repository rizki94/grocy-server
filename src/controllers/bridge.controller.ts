import { db } from "@/db";
import {
    products,
    productDetails,
    productUnits,
    productAttributeValues,
    productAttributes,
    productDetailPrices,
    priceGroups,
    transactions,
} from "@/db/schemas";
import { Request, Response } from "express";
import { eq, and, ilike, or, sql, gte, lte } from "drizzle-orm";

export async function getDashboardOmzetMobile(req: Request, res: Response) {
    const { date } = req.query;
    const targetDate = date ? new Date(date as string) : new Date();
    
    // Format to YYYY-MM-DD for consistency
    const todayStr = targetDate.toISOString().split("T")[0];
    
    const lastWeekDate = new Date(targetDate);
    lastWeekDate.setDate(lastWeekDate.getDate() - 7);
    const lastWeekStr = lastWeekDate.toISOString().split("T")[0];

    try {
        const fetchOmzet = async (dateStr: string) => {
            const result = await db
                .select({
                    total: sql<number>`COALESCE(SUM(${transactions.totalAmount}), 0)`,
                })
                .from(transactions)
                .where(
                    and(
                        eq(transactions.date, dateStr),
                        or(
                            eq(transactions.type, "sales"),
                            eq(transactions.type, "pos_sales")
                        ),
                        or(
                            eq(transactions.status, "posted"),
                            eq(transactions.status, "partial"),
                            eq(transactions.status, "paid")
                        )
                    )
                );
            return result[0]?.total || 0;
        };

        const [todayOmzet, lastWeekOmzet] = await Promise.all([
            fetchOmzet(todayStr),
            fetchOmzet(lastWeekStr),
        ]);

        res.json([
            { Date: "TODAY", Amount: todayOmzet.toString() },
            { Date: "LASTWEEK", Amount: lastWeekOmzet.toString() },
        ]);
    } catch (error) {
        console.error("Dashboard Omzet error:", error);
        res.status(500).json({ status: 500, message: "Internal server error" });
    }
}

export async function getProductStockList(req: Request, res: Response) {
    const { search = "", page = 1, limit = 20 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    try {
        // This is a complex query to flatten products for mobile compatibility
        // We'll fetch products and their details, then map them in memory or via SQL aggregation
        
        const rows = await db
            .select({
                id: products.id,
                Name: products.name,
                // We'll map attributes later or join them
            })
            .from(products)
            .where(
                search ? ilike(products.name, `%${search}%`) : undefined
            )
            .limit(Number(limit))
            .offset(offset);

        // For each product, fetch details and attributes
        const results = await Promise.all(
            rows.map(async (p) => {
                const details = await db
                    .select({
                        id: productDetails.id,
                        level: productDetails.level,
                        ratio: productDetails.ratio,
                        cost: productDetails.cost,
                        unitName: productUnits.name,
                    })
                    .from(productDetails)
                    .innerJoin(productUnits, eq(productDetails.unitId, productUnits.id))
                    .where(eq(productDetails.productId, p.id))
                    .orderBy(productDetails.level);

                const attrs = await db
                    .select({
                        name: productAttributes.name,
                        value: productAttributeValues.value,
                    })
                    .from(productAttributeValues)
                    .innerJoin(productAttributes, eq(productAttributeValues.attributeId, productAttributes.id))
                    .where(eq(productAttributeValues.productId, p.id));

                const category = attrs.find(a => a.name === "Category")?.value || "";
                
                // Map details to level 1, 2, 3, 4
                const unit1 = details.find(d => d.level === 1);
                const unit2 = details.find(d => d.level === 2);
                const unit3 = details.find(d => d.level === 3);
                const unit4 = details.find(d => d.level === 4);

                // Fetch prices for all details
                const prices = await db
                    .select({
                        productDetailId: productDetailPrices.productDetailId,
                        priceGroupName: priceGroups.name,
                        price: productDetailPrices.price,
                    })
                    .from(productDetailPrices)
                    .innerJoin(priceGroups, eq(productDetailPrices.priceGroupId, priceGroups.id))
                    .where(
                        or(
                            ...details.map(d => eq(productDetailPrices.productDetailId, d.id))
                        )
                    );

                const priceMap: Record<string, number> = {};
                // PriceGroups in mobile are A, B, C, D, E
                // We'll map our named price groups to these letters based on common patterns
                const groupMapping: Record<string, string> = {
                    "Regular Price": "A",
                    "Wholesale Price": "B",
                    "Distributor Price": "C",
                    "Member Price": "D",
                    "Promo Price": "E",
                };

                prices.forEach(pr => {
                    const letter = groupMapping[pr.priceGroupName] || "A";
                    const detail = details.find(d => d.id === pr.productDetailId);
                    if (detail) {
                        priceMap[`Price${letter}${detail.level}`] = pr.price;
                    }
                });

                // Cost mapping (PriceP)
                details.forEach(d => {
                    priceMap[`PriceP${d.level}`] = d.cost;
                });

                return {
                    id: p.id,
                    Name: p.Name,
                    Category: category,
                    Source: "PKP", // Static for now, can be mapped from attributes
                    Stock: 0, // Need to implement stock lookup
                    unit1: unit1?.unitName || "",
                    unit2: unit2?.unitName || "",
                    unit3: unit3?.unitName || "",
                    unit4: unit4?.unitName || "",
                    id1: unit1?.id || "",
                    id2: unit2?.id || "",
                    id3: unit3?.id || "",
                    id4: unit4?.id || "",
                    ratio1: unit1?.ratio || 1,
                    ratio2: unit2?.ratio || 1,
                    ratio3: unit3?.ratio || 1,
                    ratio4: unit4?.ratio || 1,
                    ...priceMap
                };
            })
        );

        res.json({
            status: 200,
            data: results,
            total: rows.length, // Simplified total
        });
    } catch (error) {
        console.error("Bridge Product List error:", error);
        res.status(500).json({ status: 500, message: "Internal server error" });
    }
}
