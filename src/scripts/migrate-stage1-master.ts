import sql from "mssql";
import bcrypt from "bcrypt";
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import {
    branches,
    warehouses,
    priceGroups,
    productUnits,
    productAttributes,
    productAttributeValues,
    contacts,
    routeGroups,
    roles,
    users,
    taxes,
    products,
    productDetails,
    productDetailPrices,
    productBranches,
} from "../db/schemas";

const mssqlConfig: sql.config = {
    user: "api",
    password: "Hrd12345",
    server: "192.168.5.100",
    port: 1433,
    database: "dbPrimaNusantara",
    options: {
        encrypt: false,
        trustServerCertificate: true,
    },
};

async function main() {
    console.log("=================================================");
    console.log("Starting Migration Stage 1: Master Data");
    console.log("Source: SQL Server dbPrimaNusantara (192.168.5.100)");
    console.log("Target: Grocy PostgreSQL Database");
    console.log("=================================================\n");

    const pool = await sql.connect(mssqlConfig);
    console.log("Connected to SQL Server successfully.\n");

    // Helper to get or create in Postgres
    async function getOrCreate<T>(table: any, check: any, values: any): Promise<T> {
        const [existing] = await db.select().from(table).where(check).limit(1);
        if (existing) return existing as T;
        const [inserted] = (await db.insert(table).values(values).returning()) as any[];
        return inserted as T;
    }

    // Default Super Admin Role
    const superAdminRole = await getOrCreate<typeof roles.$inferSelect>(
        roles,
        eq(roles.name, "super_admin"),
        { name: "super_admin" },
    );

    // Default Tax (VAT 11%)
    const defaultTax = await getOrCreate<typeof taxes.$inferSelect>(
        taxes,
        eq(taxes.name, "VAT 11%"),
        { name: "VAT 11%", rate: 11 },
    );

    // ==========================================
    // 1. Branches (mstBranch -> branches)
    // ==========================================
    console.log("1. Migrating Branches...");
    const branchesSrc = await pool.request().query("SELECT BranchId, BranchName, Address, Phone1 FROM mstBranch");
    const branchMap: Record<string, typeof branches.$inferSelect> = {};

    for (const b of branchesSrc.recordset) {
        const code = (b.BranchId || "").trim();
        const name = (b.BranchName || code).trim();
        const isHq = code === "HLD";

        const branch = await getOrCreate<typeof branches.$inferSelect>(
            branches,
            eq(branches.code, code),
            {
                code,
                name,
                address: b.Address ? b.Address.trim() : null,
                phone: b.Phone1 ? b.Phone1.trim() : null,
                isHq,
                isActive: true,
            },
        );
        branchMap[code] = branch;
    }
    console.log(`   Migrated ${Object.keys(branchMap).length} branches.`);

    // Default HQ fallback
    const hqBranch = Object.values(branchMap).find((b) => b.isHq) || Object.values(branchMap)[0];

    // ==========================================
    // 2. Warehouses (MstLocation -> warehouses)
    // ==========================================
    console.log("2. Migrating Warehouses...");
    const locSrc = await pool.request().query("SELECT AccLoc, Descr, Addr, BranchId, Active FROM MstLocation");
    const warehouseMap: Record<number, typeof warehouses.$inferSelect> = {};

    for (const l of locSrc.recordset) {
        const name = (l.Descr || `Warehouse ${l.AccLoc}`).trim();
        const branchCode = (l.BranchId || "").trim();
        const assignedBranch = branchMap[branchCode] || hqBranch;

        const warehouse = await getOrCreate<typeof warehouses.$inferSelect>(
            warehouses,
            eq(warehouses.name, name),
            {
                name,
                branchId: assignedBranch.id,
                address: l.Addr ? l.Addr.trim() : null,
                isActive: l.Active ?? true,
            },
        );
        warehouseMap[l.AccLoc] = warehouse;
    }
    console.log(`   Migrated ${Object.keys(warehouseMap).length} warehouses.`);

    // ==========================================
    // 3. Price Group (Price A)
    // ==========================================
    console.log("3. Creating Price Group (Price A)...");
    const priceGroupA = await getOrCreate<typeof priceGroups.$inferSelect>(
        priceGroups,
        eq(priceGroups.name, "Price A"),
        {
            name: "Price A",
            description: "Default Price Group A (Migrated from SQL Server)",
            isActive: true,
        },
    );
    console.log(`   Price Group ready: ${priceGroupA.name} (${priceGroupA.id})`);

    // ==========================================
    // 4. Units (MstUnit -> product_units)
    // ==========================================
    console.log("4. Migrating Product Units...");
    const unitsSrc = await pool.request().query("SELECT Id, Unit FROM MstUnit");
    const unitMap: Record<number, typeof productUnits.$inferSelect> = {};
    const usedAbbreviations = new Set<string>();

    // Load existing units
    const existingUnits = await db.select().from(productUnits);
    for (const u of existingUnits) {
        usedAbbreviations.add(u.abbreviation.toLowerCase());
    }

    for (const u of unitsSrc.recordset) {
        const unitName = (u.Unit || `Unit_${u.Id}`).trim();
        let baseAbbr = unitName.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
        if (!baseAbbr) baseAbbr = `u${u.Id}`;

        let finalAbbr = baseAbbr;
        let counter = 1;
        while (usedAbbreviations.has(finalAbbr)) {
            const existingWithAbbr = existingUnits.find((eu) => eu.abbreviation.toLowerCase() === finalAbbr);
            if (existingWithAbbr && existingWithAbbr.name.toLowerCase() === unitName.toLowerCase()) {
                unitMap[u.Id] = existingWithAbbr;
                break;
            }
            finalAbbr = `${baseAbbr}${counter++}`;
        }

        if (!unitMap[u.Id]) {
            const inserted = await getOrCreate<typeof productUnits.$inferSelect>(
                productUnits,
                eq(productUnits.name, unitName),
                {
                    name: unitName,
                    abbreviation: finalAbbr,
                },
            );
            usedAbbreviations.add(inserted.abbreviation.toLowerCase());
            unitMap[u.Id] = inserted;
        }
    }

    // Default PCS fallback
    const defaultUnit = Object.values(unitMap)[0] || existingUnits[0];
    console.log(`   Migrated ${Object.keys(unitMap).length} units.`);

    // ==========================================
    // 5. Categories (MstCatagories -> product_attributes)
    // ==========================================
    console.log("5. Migrating Product Categories...");
    const catSrc = await pool.request().query("SELECT Catagories, Descr FROM MstCatagories WHERE Descr IS NOT NULL");
    const categoryMap: Record<number, string> = {};
    const allCategoryOptions = new Set<string>(["default category"]);

    for (const c of catSrc.recordset) {
        const catName = c.Descr.trim();
        if (catName) {
            categoryMap[c.Catagories] = catName;
            allCategoryOptions.add(catName);
        }
    }

    const [existingCategoryAttr] = await db
        .select()
        .from(productAttributes)
        .where(eq(productAttributes.name, "Category"))
        .limit(1);

    let categoryAttr = existingCategoryAttr;
    if (!existingCategoryAttr) {
        const [createdAttr] = await db
            .insert(productAttributes)
            .values({
                name: "Category",
                label: "category",
                type: "enum",
                options: Array.from(allCategoryOptions),
            })
            .returning();
        categoryAttr = createdAttr;
    } else {
        // Merge options
        const mergedOptions = Array.from(new Set([...(existingCategoryAttr.options || []), ...allCategoryOptions]));
        await db
            .update(productAttributes)
            .set({ options: mergedOptions })
            .where(eq(productAttributes.id, existingCategoryAttr.id));
    }
    console.log(`   Migrated ${Object.keys(categoryMap).length} categories.`);

    // ==========================================
    // 6. Contacts (MstContact -> contacts)
    // ==========================================
    console.log("6. Migrating Contacts (Customers & Suppliers)...");
    const contactsSrc = await pool.request().query(
        "SELECT Contact, CompanyName, Address, Phone1, TypeCustomer, TypeSupplier, Term, Active FROM MstContact"
    );
    const contactMap: Record<number, typeof contacts.$inferSelect> = {};

    for (const c of contactsSrc.recordset) {
        const name = (c.CompanyName || `Contact ${c.Contact}`).trim();
        const isSupplier = Boolean(c.TypeSupplier && !c.TypeCustomer);
        const contactType = isSupplier ? ("supplier" as const) : ("customer" as const);
        const term = Math.min(32767, Math.max(0, Number(c.Term) || 0));
        const cleanNameSlug = name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20) || `contact${c.Contact}`;

        const contact = await getOrCreate<typeof contacts.$inferSelect>(
            contacts,
            eq(contacts.name, name),
            {
                name,
                contactType,
                address: c.Address && c.Address.trim() ? c.Address.trim() : "-",
                phone: c.Phone1 && c.Phone1.trim() ? c.Phone1.trim() : "-",
                email: `${cleanNameSlug}@example.com`,
                priceGroupId: priceGroupA.id,
                termOfPayment: term,
                isActive: c.Active ?? true,
            },
        );
        contactMap[c.Contact] = contact;
    }
    console.log(`   Migrated ${Object.keys(contactMap).length} contacts.`);

    // ==========================================
    // 7. Route Groups (MstBaseRoute -> route_groups)
    // ==========================================
    console.log("7. Migrating Delivery Routes...");
    const routesSrc = await pool.request().query(
        "SELECT BaseRouteId, BaseRouteName, BranchId, BaseRouteActive FROM MstBaseRoute"
    );
    const routeMap: Record<number, typeof routeGroups.$inferSelect> = {};

    for (const r of routesSrc.recordset) {
        const name = (r.BaseRouteName || `Route ${r.BaseRouteId}`).trim();
        const branchCode = (r.BranchId || "").trim();
        const assignedBranch = branchMap[branchCode] || hqBranch;

        const route = await getOrCreate<typeof routeGroups.$inferSelect>(
            routeGroups,
            eq(routeGroups.name, name),
            {
                name,
                branchId: assignedBranch.id,
                description: `Migrated route ID ${r.BaseRouteId}`,
                isActive: r.BaseRouteActive ?? true,
            },
        );
        routeMap[r.BaseRouteId] = route;
    }
    console.log(`   Migrated ${Object.keys(routeMap).length} route groups.`);

    // ==========================================
    // 8. Users (Tbl_Users -> users)
    // ==========================================
    console.log("8. Migrating Users...");
    const usersSrc = await pool.request().query(
        "SELECT UserId, UserName, FullName, BranchId FROM Tbl_Users WHERE UserName IS NOT NULL"
    );
    const defaultPasswordHash = await bcrypt.hash("12345678", 10);
    let usersMigratedCount = 0;

    for (const u of usersSrc.recordset) {
        const username = u.UserName.trim().toLowerCase();
        const displayName = (u.FullName || u.UserName).trim();
        const branchCode = (u.BranchId || "").trim();
        const assignedBranch = branchMap[branchCode] || hqBranch;

        const [existing] = await db.select().from(users).where(eq(users.username, username)).limit(1);
        if (!existing) {
            await db.insert(users).values({
                username,
                displayName,
                password: defaultPasswordHash,
                roleId: superAdminRole.id,
                branchId: assignedBranch.id,
                isActive: true,
            });
            usersMigratedCount++;
        } else if (existing.username !== "super_admin") {
            // Update password to 12345678 for migrated users
            await db
                .update(users)
                .set({ password: defaultPasswordHash })
                .where(eq(users.id, existing.id));
        }
    }
    console.log(`   Migrated/updated users (password: 12345678).`);

    // ==========================================
    // 9. Products & Price A (MstProduct -> products, product_details, product_detail_prices)
    // ==========================================
    console.log("9. Migrating Products & Pricing (Price A)...");
    const productsSrc = await pool.request().query(`
        SELECT Pkey, Product_Name, Active, Catagories,
               PriceP1, PriceP2, PriceP3, PriceP4,
               PriceA1, PriceA2, PriceA3, PriceA4,
               Rat1, Rat2, Rat3, Rat4,
               Unit1, Unit2, Unit3, Unit4,
               Weight1, Weight2, Weight3, Weight4
        FROM MstProduct
        WHERE Pkey IS NOT NULL
    `);

    let productsCount = 0;
    let detailsCount = 0;
    const existingProductsList = await db.select().from(products);
    const existingProductNames = new Set(existingProductsList.map((p) => p.name));

    for (const p of productsSrc.recordset) {
        const skuBase = p.Pkey.trim();
        let prodName = (p.Product_Name || skuBase).trim();

        // Disambiguate duplicate product names if any
        if (existingProductNames.has(prodName)) {
            const existingWithSameName = existingProductsList.find((ep) => ep.name === prodName);
            // Check if it's the exact same sku
            const [existingDetail] = await db
                .select()
                .from(productDetails)
                .where(eq(productDetails.skuId, skuBase))
                .limit(1);

            if (!existingDetail) {
                prodName = `${prodName} (${skuBase})`;
            }
        }

        const product = await getOrCreate<typeof products.$inferSelect>(
            products,
            eq(products.name, prodName),
            {
                name: prodName,
                description: `Product ${skuBase} from SQL Server`,
                taxId: defaultTax.id,
                isActive: p.Active ?? true,
                isGlobal: true,
            },
        );
        existingProductNames.add(prodName);
        productsCount++;

        // Assign Category Attribute
        const catName = categoryMap[p.Catagories];
        if (catName && categoryAttr) {
            await getOrCreate(
                productAttributeValues,
                and(
                    eq(productAttributeValues.productId, product.id),
                    eq(productAttributeValues.attributeId, categoryAttr.id),
                ),
                {
                    productId: product.id,
                    attributeId: categoryAttr.id,
                    value: catName,
                },
            );
        }

        // Link product to all branches
        for (const branch of Object.values(branchMap)) {
            await getOrCreate(
                productBranches,
                and(
                    eq(productBranches.productId, product.id),
                    eq(productBranches.branchId, branch.id),
                ),
                {
                    productId: product.id,
                    branchId: branch.id,
                },
            );
        }

        // Process Level 1 to Level 4 units & prices
        let prevBaseRatio = 1;
        for (let level = 1; level <= 4; level++) {
            const unitSrcId = p[`Unit${level}`];
            const unit = unitMap[unitSrcId] || (level === 1 ? defaultUnit : null);

            // Level 1 is always created. Higher levels are created only if they have a valid unit
            if (!unit) continue;

            const skuId = level === 1 ? skuBase : `${skuBase}-L${level}`;
            const cost = Number(p[`PriceP${level}`]) || 0;
            const priceA = Number(p[`PriceA${level}`]) || 0;
            const rawBaseRatio = Number(p[`Rat${level}`]) || (level === 1 ? 1 : 1);
            const ratio =
                level === 1
                    ? 1
                    : Math.min(
                          32767,
                          Math.max(1, Math.round(prevBaseRatio / (rawBaseRatio || 1))),
                      );
            prevBaseRatio = rawBaseRatio;
            const weight = Number(p[`Weight${level}`]) || 0;

            const detail = await getOrCreate<typeof productDetails.$inferSelect>(
                productDetails,
                eq(productDetails.skuId, skuId),
                {
                    productId: product.id,
                    unitId: unit.id,
                    skuId,
                    level,
                    ratio,
                    baseRatio: rawBaseRatio,
                    cost,
                    weight,
                    isSellable: true,
                    isDefault: level === 1,
                },
            );
            detailsCount++;

            // Create / update Price A in productDetailPrices
            const [existingPrice] = await db
                .select()
                .from(productDetailPrices)
                .where(
                    and(
                        eq(productDetailPrices.productDetailId, detail.id),
                        eq(productDetailPrices.priceGroupId, priceGroupA.id),
                    ),
                )
                .limit(1);

            if (!existingPrice) {
                await db.insert(productDetailPrices).values({
                    productDetailId: detail.id,
                    priceGroupId: priceGroupA.id,
                    branchId: null, // Global price across branches
                    price: priceA,
                });
            } else {
                await db
                    .update(productDetailPrices)
                    .set({ price: priceA })
                    .where(eq(productDetailPrices.id, existingPrice.id));
            }
        }
    }

    console.log(`   Migrated ${productsCount} products and ${detailsCount} unit levels with Price A.`);

    await pool.close();
    console.log("\n=================================================");
    console.log("Migration Stage 1 (Master Data) Completed Successfully!");
    console.log("=================================================");
    process.exit(0);
}

main().catch((err) => {
    console.error("\n❌ Migration Stage 1 Failed:", err);
    process.exit(1);
});
