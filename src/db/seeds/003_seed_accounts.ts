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
} from "../schemas";

export async function seedAccounts(dbInstance: typeof db) {
    console.log("Seeding basic data...");

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

    // 1. Roles
    const superAdminRole = await getOrCreate<typeof roles.$inferSelect>(
        roles,
        eq(roles.name, "super_admin"),
        { name: "super_admin" },
    );

    // 2. Permission Groups & Permissions
    const groupsRaw = [
        { name: "User Management", code: "user" },
        { name: "Product Management", code: "product" },
        { name: "Contact Management", code: "contact" },
        { name: "Transaction Management", code: "transaction" },
        { name: "Accounting Management", code: "accounting" },
        { name: "Report & Analytics", code: "report" },
        { name: "Settings & Setup", code: "settings" },
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
        { code: "user.create", description: "Create User", group: "user" },
        { code: "user.update", description: "Update User", group: "user" },
        { code: "user.view", description: "View Users", group: "user" },
        { code: "user.delete", description: "Delete User", group: "user" },
        {
            code: "product.create",
            description: "Create Product",
            group: "product",
        },
        {
            code: "product.update",
            description: "Update Product",
            group: "product",
        },
        {
            code: "product.view",
            description: "View Products",
            group: "product",
        },
        {
            code: "product.delete",
            description: "Delete Product",
            group: "product",
        },
        // Contact
        { code: "contact.view", description: "View Contacts", group: "contact" },
        { code: "contact.create", description: "Create Contact", group: "contact" },
        { code: "contact.update", description: "Update Contact", group: "contact" },
        { code: "contact.delete", description: "Delete Contact", group: "contact" },

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

        // Reports
        { code: "report.profit_loss.view", description: "View Profit & Loss", group: "report" },
        { code: "report.balance_sheet.view", description: "View Balance Sheet", group: "report" },
        { code: "report.product_profitability.view", description: "View Product Profitability", group: "report" },

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

    // 3. Assign all permissions to super_admin
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

    // 4. Default User
    const [existingUser] = await dbInstance
        .select()
        .from(users)
        .where(eq(users.username, "super_admin"))
        .limit(1);

    if (!existingUser) {
        const hashed = await bcrypt.hash("ngalagena", 10);
        await dbInstance.insert(users).values({
            username: "super_admin",
            password: hashed,
            roleId: superAdminRole.id,
            isActive: true,
        });
    }

    // 5. Basic Master Data

    // Tax
    const tax = await getOrCreate<typeof taxes.$inferSelect>(
        taxes,
        eq(taxes.name, "VAT 11%"),
        { name: "VAT 11%", rate: 11 },
    );

    // Units
    const unitsData = [
        { name: "Pieces", abbreviation: "pcs" },
        { name: "Kilogram", abbreviation: "kg" },
        { name: "Gram", abbreviation: "g" },
        { name: "Liter", abbreviation: "l" },
        { name: "Milliliter", abbreviation: "ml" },
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

    // 6. Contacts (Customer & Supplier)
    await getOrCreate(contacts, eq(contacts.name, "General Customer"), {
        contactType: "customer",
        name: "General Customer",
        address: "123 Main St",
        phone: "555-0100",
        email: "customer@example.com",
    });

    await getOrCreate(contacts, eq(contacts.name, "General Supplier"), {
        contactType: "supplier",
        name: "General Supplier",
        address: "456 Market St",
        phone: "555-0200",
        email: "supplier@example.com",
        termOfPayment: 30,
    });

    // 7. Regular Product
    const product = await getOrCreate<typeof products.$inferSelect>(
        products,
        eq(products.name, "Mineral Water 600ml"),
        {
            name: "Mineral Water 600ml",
            description: "Fresh mineral water",
            taxId: tax.id,
            isActive: true,
        },
    );

    // Product Detail (Main Unit)
    await getOrCreate<typeof productDetails.$inferSelect>(
        productDetails,
        eq(productDetails.skuId, "MW-600"),
        {
            productId: product.id,
            unitId: pcsUnit.id,
            skuId: "MW-600",
            barcode: "8991234567890",
            level: 1,
            ratio: 1,
            baseRatio: 1,
            cost: 3000,
            price: 5000,
            weight: 0.6,
            isSellable: true,
            isDefault: true,
        },
    );

    console.log(
        "Seeding basic data (Product, User, TRole, Tax, Unit, Contact) completed.",
    );
}
