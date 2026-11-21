export interface PermissionGroupDef {
    name: string;
    code: string;
}

export interface PermissionDef {
    code: string;
    description: string;
    group: string;
}

export const PERMISSION_GROUPS: PermissionGroupDef[] = [
    { name: "User Management", code: "user" },
    { name: "Product Management", code: "product" },
    { name: "Contact Management", code: "contact" },
    { name: "Transaction Management", code: "transaction" },
    { name: "Accounting Management", code: "accounting" },
    { name: "Report & Analytics", code: "report" },
    { name: "Settings & Setup", code: "settings" },
    { name: "Point of Sale", code: "pos" },
    { name: "System Administration", code: "sysadmin" },
    { name: "HRD & Payroll", code: "hrd" },
    { name: "Delivery & Dispatch", code: "dispatch" },
    { name: "Marketplace Integration", code: "marketplace" },
    { name: "CRM & Loyalty", code: "crm" },
];

export const ALL_PERMISSIONS: PermissionDef[] = [
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
    { code: "product.attribute.view", description: "View Product Attributes", group: "product" },
    { code: "product.attribute.manage", description: "Manage Product Attributes", group: "product" },
    { code: "product.branch.manage", description: "Manage Product Branches", group: "product" },

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
    { code: "accounting.audit.view", description: "View Data Integrity Audit", group: "accounting" },
    { code: "accounting.audit.reconcile", description: "Reconcile Data Integrity", group: "accounting" },

    // Reports
    { code: "report.profit_loss.view", description: "View Profit & Loss", group: "report" },
    { code: "report.balance_sheet.view", description: "View Balance Sheet", group: "report" },
    { code: "report.product_profitability.view", description: "View Product Profitability", group: "report" },
    { code: "report.cogs.view", description: "View COGS & Inventory Movement Report", group: "report" },
    { code: "report.gl_balance.view", description: "View GL Balances", group: "report" },
    { code: "report.customer_outstanding.view", description: "View Customer Outstanding AR", group: "report" },
    { code: "report.transaction_summary.view", description: "View Transaction Summary Report", group: "report" },
    { code: "report.aging.view", description: "View Aging AR & AP Reports", group: "report" },

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

    { code: "settings.route_group.view", description: "View Route Groups", group: "settings" },
    { code: "settings.route_group.create", description: "Create Route Group", group: "settings" },
    { code: "settings.route_group.update", description: "Update Route Group", group: "settings" },

    // POS
    { code: "pos.interface.view", description: "View POS Interface", group: "pos" },

    // SysAdmin
    { code: "sysadmin.access", description: "Access System Administration", group: "sysadmin" },

    // HRD & Payroll
    { code: "hrd.employees.view", description: "View HRD Employees", group: "hrd" },
    { code: "hrd.employees.create", description: "Create HRD Employee", group: "hrd" },
    { code: "hrd.employees.update", description: "Update HRD Employee", group: "hrd" },
    { code: "hrd.employees.delete", description: "Delete HRD Employee", group: "hrd" },
    { code: "hrd.attendance.view", description: "View Attendance Records", group: "hrd" },
    { code: "hrd.attendance.create", description: "Create Attendance Record", group: "hrd" },
    { code: "hrd.attendance.update", description: "Update Attendance Record", group: "hrd" },
    { code: "hrd.payroll.view", description: "View Payroll", group: "hrd" },
    { code: "hrd.payroll.create", description: "Create Payroll", group: "hrd" },
    { code: "hrd.payroll.update", description: "Update Payroll", group: "hrd" },
    { code: "hrd.work_shifts.view", description: "View Work Shifts", group: "hrd" },
    { code: "hrd.work_shifts.create", description: "Create Work Shift", group: "hrd" },
    { code: "hrd.work_shifts.update", description: "Update Work Shift", group: "hrd" },

    // Delivery & Dispatch
    { code: "dispatch.view", description: "View Delivery Dispatch", group: "dispatch" },
    { code: "dispatch.create", description: "Create Delivery Dispatch", group: "dispatch" },
    { code: "dispatch.update", description: "Update Delivery Dispatch", group: "dispatch" },
    { code: "dispatch.delete", description: "Delete Delivery Dispatch", group: "dispatch" },
    { code: "dispatch.driver.view", description: "View Drivers", group: "dispatch" },
    { code: "dispatch.driver.create", description: "Create Driver", group: "dispatch" },
    { code: "dispatch.driver.update", description: "Update Driver", group: "dispatch" },
    { code: "dispatch.driver.delete", description: "Delete Driver", group: "dispatch" },
    { code: "dispatch.truck.view", description: "View Trucks", group: "dispatch" },
    { code: "dispatch.truck.create", description: "Create Truck", group: "dispatch" },
    { code: "dispatch.truck.update", description: "Update Truck", group: "dispatch" },
    { code: "dispatch.truck.delete", description: "Delete Truck", group: "dispatch" },
    { code: "dispatch.route.view", description: "View Delivery Routes", group: "dispatch" },
    { code: "dispatch.route.create", description: "Create Delivery Route", group: "dispatch" },
    { code: "dispatch.route.update", description: "Update Delivery Route", group: "dispatch" },
    { code: "dispatch.route.delete", description: "Delete Delivery Route", group: "dispatch" },

    // Marketplace
    { code: "marketplace.view", description: "View Marketplaces", group: "marketplace" },
    { code: "marketplace.create", description: "Create Marketplace Connection", group: "marketplace" },
    { code: "marketplace.update", description: "Update Marketplace Connection", group: "marketplace" },
    { code: "marketplace.delete", description: "Delete Marketplace Connection", group: "marketplace" },

    // CRM
    { code: "crm.view", description: "View CRM & Loyalty", group: "crm" },
    { code: "crm.create", description: "Create CRM & Loyalty", group: "crm" },
    { code: "crm.update", description: "Update CRM & Loyalty", group: "crm" },
    { code: "crm.delete", description: "Delete CRM & Loyalty", group: "crm" },
];

export const ALL_PERMISSION_CODES: string[] = ALL_PERMISSIONS.map((p) => p.code);
