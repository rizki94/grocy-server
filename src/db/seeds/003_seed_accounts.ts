import bcrypt from "bcrypt";
import { db } from "..";
import { eq, and } from "drizzle-orm";
import {
    users,
    roles,
    permissions,
    rolePermissions,
    permissionGroups,
    productUnits,
    taxes,
    contacts,
    products,
    productDetails,
    warehouses,
    priceGroups,
    productAttributes,
    productAttributeValues,
    branches,
    productBranches,
    paymentMethods,
    returnReasons,
    glAccounts,
} from "../schemas";

export async function seedAccounts(dbInstance: typeof db) {
    console.log("Seeding basic master data...");

    // Helper to get or create
    async function getOrCreate<T>(
        table: any,
        check: any,
        values: any,
    ): Promise<T> {
        const [existing] = await dbInstance
            .select()
            .from(table)
            .where(check)
            .limit(1);
        if (existing) return existing as T;
        const [inserted] = (await dbInstance
            .insert(table)
            .values(values)
            .returning()) as any[];
        return inserted as T;
    }

    // 1. Branch
    const hqBranch = await getOrCreate<typeof branches.$inferSelect>(
        branches,
        eq(branches.code, "HQ"),
        {
            code: "HQ",
            name: "Headquarters",
            address: "Jl. Sudirman Kav. 1, Jakarta",
            phone: "021-5550100",
            isHq: true,
            isActive: true,
        },
    );

    // 2. Roles
    const superAdminRole = await getOrCreate<typeof roles.$inferSelect>(
        roles,
        eq(roles.name, "super_admin"),
        { name: "super_admin" },
    );

    // 3. Permission Groups & Permissions
    const groupsRaw = [
        { name: "User Management", code: "user" },
        { name: "Product Management", code: "product" },
        { name: "Contact Management", code: "contact" },
        { name: "Transaction Management", code: "transaction" },
        { name: "Accounting Management", code: "accounting" },
        { name: "Report & Analytics", code: "report" },
        { name: "Settings & Setup", code: "settings" },
        { name: "Point of Sale", code: "pos" },
        { name: "System Administration", code: "sysadmin" },
    ];

    const permissionGroupsMap: Record<string, string> = {}; // code -> id

    for (const g of groupsRaw) {
        const group = await getOrCreate<typeof permissionGroups.$inferSelect>(
            permissionGroups,
            eq(permissionGroups.name, g.name),
            { name: g.name },
        );
        permissionGroupsMap[g.code] = group.id;
    }

    const permissionsList = [
        // User
        { code: "user.create", description: "Create User", group: "user" },
        { code: "user.update", description: "Update User", group: "user" },
        { code: "user.view", description: "View Users", group: "user" },
        { code: "user.delete", description: "Delete User", group: "user" },

        // Product
        { code: "product.create", description: "Create Product", group: "product" },
        { code: "product.update", description: "Update Product", group: "product" },
        { code: "product.view", description: "View Products", group: "product" },
        { code: "product.delete", description: "Delete Product", group: "product" },

        // Contact
        { code: "contact.customer.view", description: "View Customers", group: "contact" },
        { code: "contact.customer.create", description: "Create Customer", group: "contact" },
        { code: "contact.customer.update", description: "Update Customer", group: "contact" },
        { code: "contact.supplier.view", description: "View Suppliers", group: "contact" },
        { code: "contact.supplier.create", description: "Create Supplier", group: "contact" },
        { code: "contact.supplier.update", description: "Update Supplier", group: "contact" },

        // Transactions
        { code: "transaction.purchase.view", description: "View Purchase", group: "transaction" },
        { code: "transaction.purchase.create", description: "Create Purchase", group: "transaction" },
        { code: "transaction.purchase.update", description: "Update Purchase", group: "transaction" },
        { code: "transaction.purchase.delete", description: "Delete Purchase", group: "transaction" },
        { code: "transaction.purchase.post", description: "Post Purchase", group: "transaction" },

        { code: "transaction.sales.view", description: "View Sales", group: "transaction" },
        { code: "transaction.sales.create", description: "Create Sales", group: "transaction" },
        { code: "transaction.sales.update", description: "Update Sales", group: "transaction" },
        { code: "transaction.sales.delete", description: "Delete Sales", group: "transaction" },
        { code: "transaction.sales.post", description: "Post Sales", group: "transaction" },

        { code: "transaction.adjustment.view", description: "View Adjustment", group: "transaction" },
        { code: "transaction.adjustment.create", description: "Create Adjustment", group: "transaction" },
        { code: "transaction.adjustment.post", description: "Post Adjustment", group: "transaction" },

        { code: "transaction.transfer_stock.view", description: "View Transfer Stock", group: "transaction" },
        { code: "transaction.transfer_stock.create", description: "Create Transfer Stock", group: "transaction" },
        { code: "transaction.transfer_stock.update", description: "Update Transfer Stock", group: "transaction" },
        { code: "transaction.transfer_stock.delete", description: "Delete Transfer Stock", group: "transaction" },
        { code: "transaction.transfer_stock.post", description: "Post Transfer Stock", group: "transaction" },

        { code: "transaction.stock_opname.view", description: "View Stock Opname", group: "transaction" },
        { code: "transaction.stock_opname.create", description: "Create Stock Opname", group: "transaction" },
        { code: "transaction.stock_opname.update", description: "Update Stock Opname", group: "transaction" },
        { code: "transaction.stock_opname.complete", description: "Complete Stock Opname", group: "transaction" },
        { code: "transaction.stock_opname.cancel", description: "Cancel Stock Opname", group: "transaction" },

        // Accounting
        { code: "accounting.gl.view", description: "View GL Accounts", group: "accounting" },
        { code: "accounting.gl.create", description: "Create GL Account", group: "accounting" },
        { code: "accounting.gl.update", description: "Update GL Account", group: "accounting" },
        { code: "accounting.gl.delete", description: "Delete GL Account", group: "accounting" },

        { code: "accounting.journal.view", description: "View Journals", group: "accounting" },
        { code: "accounting.journal.create", description: "Create Journal", group: "accounting" },
        { code: "accounting.journal.post", description: "Post Journal", group: "accounting" },

        { code: "accounting.payment.view", description: "View Payments", group: "accounting" },
        { code: "accounting.payment.create", description: "Create Payment", group: "accounting" },
        { code: "accounting.payment.post", description: "Post Payment", group: "accounting" },

        { code: "accounting.closing.view", description: "View Period Closing", group: "accounting" },
        { code: "accounting.closing.create", description: "Execute Period Closing", group: "accounting" },
        { code: "accounting.closing.reopen", description: "Reopen Closed Period", group: "accounting" },

        { code: "accounting.bank_reconciliation.view", description: "View Bank Reconciliation", group: "accounting" },
        { code: "accounting.bank_reconciliation.create", description: "Create Bank Reconciliation", group: "accounting" },
        { code: "accounting.bank_reconciliation.reconcile", description: "Reconcile Bank Statements", group: "accounting" },
        { code: "accounting.bank_reconciliation.cancel", description: "Cancel Bank Reconciliation", group: "accounting" },

        // Reports
        { code: "report.profit_loss.view", description: "View Profit & Loss", group: "report" },
        { code: "report.balance_sheet.view", description: "View Balance Sheet", group: "report" },
        { code: "report.product_profitability.view", description: "View Product Profitability", group: "report" },
        { code: "report.gl_balance.view", description: "View GL Balances", group: "report" },
        { code: "report.customer_outstanding.view", description: "View Customer Outstanding AR", group: "report" },
        { code: "report.transaction_summary.view", description: "View Transaction Summary Report", group: "report" },

        // Settings
        { code: "settings.role.view", description: "View Roles", group: "settings" },
        { code: "settings.role.create", description: "Create Role", group: "settings" },
        { code: "settings.role.update", description: "Update Role", group: "settings" },
        { code: "settings.role.delete", description: "Delete Role", group: "settings" },

        { code: "settings.tax.view", description: "View Taxes", group: "settings" },
        { code: "settings.tax.create", description: "Create Tax", group: "settings" },
        { code: "settings.tax.update", description: "Update Tax", group: "settings" },

        { code: "settings.unit.view", description: "View Units", group: "settings" },
        { code: "settings.unit.create", description: "Create Unit", group: "settings" },

        { code: "settings.warehouse.view", description: "View Warehouses", group: "settings" },
        { code: "settings.warehouse.create", description: "Create Warehouse", group: "settings" },
        { code: "settings.warehouse.update", description: "Update Warehouse", group: "settings" },

        { code: "settings.price_group.view", description: "View Price Groups", group: "settings" },
        { code: "settings.price_group.create", description: "Create Price Group", group: "settings" },
        { code: "settings.price_group.update", description: "Update Price Group", group: "settings" },

        { code: "settings.payment_method.view", description: "View Payment Methods", group: "settings" },
        { code: "settings.payment_method.create", description: "Create Payment Method", group: "settings" },
        { code: "settings.payment_method.update", description: "Update Payment Method", group: "settings" },

        { code: "settings.branch.view", description: "View Branches", group: "settings" },
        { code: "settings.branch.create", description: "Create Branch", group: "settings" },
        { code: "settings.branch.update", description: "Update Branch", group: "settings" },
        { code: "settings.branch.delete", description: "Delete Branch", group: "settings" },

        // POS
        { code: "pos.interface.view", description: "View POS Interface", group: "pos" },

        // SysAdmin
        { code: "sysadmin.access", description: "Access System Administration", group: "sysadmin" },
    ];

    const insertedPermissions: (typeof permissions.$inferSelect)[] = [];
    for (const p of permissionsList) {
        const perm = await getOrCreate<typeof permissions.$inferSelect>(
            permissions,
            eq(permissions.code, p.code),
            {
                code: p.code,
                description: p.description,
                groupId: permissionGroupsMap[p.group],
            },
        );
        insertedPermissions.push(perm);
    }

    // 4. Assign all permissions to super_admin
    for (const p of insertedPermissions) {
        await getOrCreate(
            rolePermissions,
            and(
                eq(rolePermissions.roleId, superAdminRole.id),
                eq(rolePermissions.permissionId, p.id),
            ),
            {
                roleId: superAdminRole.id,
                permissionId: p.id,
                hasPermission: true,
            },
        );
    }

    // 5. Warehouses
    const regularWarehouse = await getOrCreate<typeof warehouses.$inferSelect>(
        warehouses,
        eq(warehouses.name, "Regular Warehouse"),
        {
            name: "Regular Warehouse",
            branchId: hqBranch.id,
            address: "Jl. Pergudangan Utama No. 10, Jakarta",
            phone: "021-5550110",
            isActive: true,
        },
    );

    const storeWarehouse = await getOrCreate<typeof warehouses.$inferSelect>(
        warehouses,
        eq(warehouses.name, "Store Warehouse"),
        {
            name: "Store Warehouse",
            branchId: hqBranch.id,
            address: "Jl. Toko Retail No. 1, Jakarta",
            phone: "021-5550111",
            isActive: true,
        },
    );

    // 6. GL Accounts lookup (Kas & Bank)
    const [cashGl] = await dbInstance
        .select()
        .from(glAccounts)
        .where(eq(glAccounts.code, "1100"))
        .limit(1);

    const [bankGl] = await dbInstance
        .select()
        .from(glAccounts)
        .where(eq(glAccounts.code, "1200"))
        .limit(1);

    // 7. Default Super Admin User
    const [existingUser] = await dbInstance
        .select()
        .from(users)
        .where(eq(users.username, "super_admin"))
        .limit(1);

    if (!existingUser) {
        const hashed = await bcrypt.hash("ngalagena", 10);
        await dbInstance.insert(users).values({
            username: "super_admin",
            displayName: "Super Administrator",
            password: hashed,
            roleId: superAdminRole.id,
            branchId: hqBranch.id,
            posWarehouseId: regularWarehouse.id,
            cashGlAccountId: cashGl?.id || null,
            isActive: true,
        });
    } else {
        await dbInstance
            .update(users)
            .set({
                branchId: hqBranch.id,
                posWarehouseId: regularWarehouse.id,
                cashGlAccountId: cashGl?.id || null,
            })
            .where(eq(users.id, existingUser.id));
    }

    // 8. Tax
    const tax = await getOrCreate<typeof taxes.$inferSelect>(
        taxes,
        eq(taxes.name, "VAT 11%"),
        { name: "VAT 11%", rate: 11 },
    );

    // 9. Units
    const unitsData = [
        { name: "Pieces", abbreviation: "pcs" },
        { name: "Kilogram", abbreviation: "kg" },
        { name: "Gram", abbreviation: "g" },
        { name: "Liter", abbreviation: "l" },
        { name: "Milliliter", abbreviation: "ml" },
        { name: "Box", abbreviation: "box" },
        { name: "Pack", abbreviation: "pack" },
    ];

    const allUnits: (typeof productUnits.$inferSelect)[] = [];
    for (const u of unitsData) {
        const unit = await getOrCreate<typeof productUnits.$inferSelect>(
            productUnits,
            eq(productUnits.abbreviation, u.abbreviation),
            { ...u },
        );
        allUnits.push(unit);
    }
    const pcsUnit = allUnits.find((u) => u.abbreviation === "pcs")!;

    // 10. Contacts (Customer & Supplier)
    await getOrCreate(contacts, eq(contacts.name, "General Customer"), {
        contactType: "customer",
        name: "General Customer",
        address: "Jl. Pelanggan Umum No. 1, Jakarta",
        phone: "0812-0000-0001",
        email: "customer@example.com",
    });

    await getOrCreate(contacts, eq(contacts.name, "PT Berkah Abadi Retail"), {
        contactType: "customer",
        name: "PT Berkah Abadi Retail",
        address: "Jl. Sudirman Kav. 45, Jakarta Selatan",
        phone: "0812-3456-7890",
        email: "purchasing@berkahabadi.example.com",
        termOfPayment: 14,
    });

    await getOrCreate(contacts, eq(contacts.name, "General Supplier"), {
        contactType: "supplier",
        name: "General Supplier",
        address: "Jl. Pasar Induk No. 5, Jakarta",
        phone: "0812-0000-0002",
        email: "supplier@example.com",
        termOfPayment: 30,
    });

    await getOrCreate(contacts, eq(contacts.name, "PT Indofood CBP Sukses Makmur"), {
        contactType: "supplier",
        name: "PT Indofood CBP Sukses Makmur",
        address: "Kawasan Industri Pulo Gadung, Jakarta Timur",
        phone: "021-4601234",
        email: "distributor@indofood.example.com",
        termOfPayment: 30,
    });

    // 11. Price Groups
    await getOrCreate(priceGroups, eq(priceGroups.name, "Regular Price"), {
        name: "Regular Price",
        description: "Regular retail price",
        isActive: true,
    });

    // 12. Payment Methods
    if (cashGl) {
        await getOrCreate(paymentMethods, eq(paymentMethods.name, "Cash"), {
            name: "Cash",
            color: "#16a34a",
            icon: "Banknote",
            isCash: true,
            glAccountId: cashGl.id,
        });
    }

    if (bankGl) {
        await getOrCreate(paymentMethods, eq(paymentMethods.name, "Bank Transfer"), {
            name: "Bank Transfer",
            color: "#2563eb",
            icon: "CreditCard",
            isCash: false,
            glAccountId: bankGl.id,
        });

        await getOrCreate(paymentMethods, eq(paymentMethods.name, "QRIS"), {
            name: "QRIS",
            color: "#9333ea",
            icon: "QrCode",
            isCash: false,
            glAccountId: bankGl.id,
        });
    }

    // 13. Return Reasons
    const returnReasonsData = [
        {
            name: "Barang Rusak / Cacat",
            code: "DMG",
            type: "all" as const,
            description: "Barang rusak, bocor, atau kemasan cacat fisik",
            isActive: true,
        },
        {
            name: "Salah Kirim Barang",
            code: "WRG",
            type: "all" as const,
            description: "Barang yang diterima tidak sesuai pesanan / surat jalan",
            isActive: true,
        },
        {
            name: "Kadaluarsa / Expired",
            code: "EXP",
            type: "all" as const,
            description: "Masa berlaku produk telah habis / mendekati expired",
            isActive: true,
        },
    ];

    for (const r of returnReasonsData) {
        await getOrCreate(returnReasons, eq(returnReasons.name, r.name), r);
    }

    // 14. Product Attributes (Category)
    const categoryAttr = await getOrCreate<typeof productAttributes.$inferSelect>(
        productAttributes,
        eq(productAttributes.name, "Category"),
        {
            name: "Category",
            label: "category",
            type: "enum",
            options: [
                "default category",
                "Minuman",
                "Makanan Ringan",
                "Susu & Olahan",
                "Kopi & Teh",
            ],
        },
    );

    // 15. Products & Product Details
    const sampleProductsData = [
        {
            name: "Mineral Water 600ml",
            description: "Air mineral pegunungan botol 600ml",
            category: "Minuman",
            skuId: "MW-600",
            barcode: "8991234567890",
            cost: 3000,
            price: 5000,
            weight: 0.6,
        },
        {
            name: "Indomie Goreng Original",
            description: "Mi instan goreng rasa original 85g",
            category: "Makanan Ringan",
            skuId: "IDM-GRG",
            barcode: "8998866200223",
            cost: 2800,
            price: 3500,
            weight: 0.085,
        },
        {
            name: "Ultra Milk Coklat 250ml",
            description: "Susu UHT rasa coklat kemasan 250ml",
            category: "Susu & Olahan",
            skuId: "UM-250",
            barcode: "8992753211234",
            cost: 5500,
            price: 7000,
            weight: 0.25,
        },
        {
            name: "Kopi Kapal Api Special 165g",
            description: "Kopi bubuk murni aroma mantap 165g",
            category: "Kopi & Teh",
            skuId: "KPA-165",
            barcode: "8991001201015",
            cost: 12000,
            price: 16000,
            weight: 0.165,
        },
    ];

    for (const p of sampleProductsData) {
        const prod = await getOrCreate<typeof products.$inferSelect>(
            products,
            eq(products.name, p.name),
            {
                name: p.name,
                description: p.description,
                taxId: tax.id,
                isActive: true,
                isGlobal: true,
            },
        );

        // Assign category attribute
        await getOrCreate(
            productAttributeValues,
            and(
                eq(productAttributeValues.productId, prod.id),
                eq(productAttributeValues.attributeId, categoryAttr.id),
            ),
            {
                productId: prod.id,
                attributeId: categoryAttr.id,
                value: p.category,
            },
        );

        // Product detail (Main unit)
        await getOrCreate<typeof productDetails.$inferSelect>(
            productDetails,
            eq(productDetails.skuId, p.skuId),
            {
                productId: prod.id,
                unitId: pcsUnit.id,
                skuId: p.skuId,
                barcode: p.barcode,
                level: 1,
                ratio: 1,
                baseRatio: 1,
                cost: p.cost,
                price: p.price,
                weight: p.weight,
                isSellable: true,
                isDefault: true,
            },
        );

        // Link product to branch
        await getOrCreate(
            productBranches,
            and(
                eq(productBranches.productId, prod.id),
                eq(productBranches.branchId, hqBranch.id),
            ),
            {
                productId: prod.id,
                branchId: hqBranch.id,
            },
        );
    }

    console.log(
        "Seeding basic master data (Branches, Users, Roles, Permissions, Taxes, Units, Contacts, Payment Methods, Return Reasons, Products) completed.",
    );
}
