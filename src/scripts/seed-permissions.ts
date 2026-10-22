import { db } from "../db";
import { roles, permissions, permissionGroups, rolePermissions, users } from "../db/schemas";
import { eq, and } from "drizzle-orm";

async function main() {
    console.log("Seeding permissions and assigning to super_admin...");

    // Helper to get or create
    async function getOrCreate<T>(
        table: any,
        check: any,
        values: any,
    ): Promise<T> {
        const [existing] = await db
            .select()
            .from(table)
            .where(check)
            .limit(1);
        if (existing) return existing as T;
        const [inserted] = (await db
            .insert(table)
            .values(values)
            .returning()) as any[];
        return inserted as T;
    }

    // 1. Ensure standard roles exist
    const standardRoles = ["super_admin", "admin", "cashier", "warehouse", "accountant", "user"];
    const rolesMap: Record<string, typeof roles.$inferSelect> = {};

    for (const roleName of standardRoles) {
        rolesMap[roleName] = await getOrCreate<typeof roles.$inferSelect>(
            roles,
            eq(roles.name, roleName),
            { name: roleName },
        );
    }
    const superAdminRole = rolesMap["super_admin"];
    console.log(`Roles ensured: ${Object.keys(rolesMap).join(", ")}`);

    // 2. Permission Groups
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

    const permissionGroupsMap: Record<string, string> = {};

    for (const g of groupsRaw) {
        const group = await getOrCreate<typeof permissionGroups.$inferSelect>(
            permissionGroups,
            eq(permissionGroups.name, g.name),
            { name: g.name },
        );
        permissionGroupsMap[g.code] = group.id;
    }

    // 3. Permissions List from 003_seed_accounts.ts
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
    console.log(`Total permissions seeded: ${insertedPermissions.length}`);

    // 4. Assign ALL permissions to super_admin
    let assignedCount = 0;
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
        assignedCount++;
    }
    console.log(`Assigned ${assignedCount} permissions to super_admin`);

    // 5. Ensure user 'rizky' has roleId set to super_admin
    const [rizky] = await db
        .select()
        .from(users)
        .where(eq(users.username, "rizky"))
        .limit(1);

    if (rizky) {
        await db
            .update(users)
            .set({
                roleId: superAdminRole.id,
                isActive: true,
            })
            .where(eq(users.id, rizky.id));
        console.log(`User 'rizky' assigned super_admin role successfully.`);
    } else {
        console.log(`User 'rizky' not found.`);
    }

    console.log("Done!");
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
