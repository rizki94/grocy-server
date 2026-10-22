import { db } from "..";
import { eq, and } from "drizzle-orm";
import {
    users,
    branches,
    warehouses,
    products,
    productDetails,
    contacts,
    glAccounts,
    transactions,
    transactionDetails,
    stocks,
    stockMovements,
    stockLayers,
    journals,
    journalEntries,
    openInvoices,
    expenses,
    expenseLines,
    incomes,
    incomeLines,
    stockOpnames,
    stockOpnameItems,
    bankReconciliations,
    bankReconciliationItems,
} from "../schemas";

export async function seedDemoData(dbInstance: typeof db) {
    console.log("Seeding demo transactions & operational data...");

    // 1. Resolve master data references
    const [hqBranch] = await dbInstance
        .select()
        .from(branches)
        .where(eq(branches.code, "HQ"))
        .limit(1);

    const [adminUser] = await dbInstance
        .select()
        .from(users)
        .where(eq(users.username, "super_admin"))
        .limit(1);

    const [regularWarehouse] = await dbInstance
        .select()
        .from(warehouses)
        .where(eq(warehouses.name, "Regular Warehouse"))
        .limit(1);

    if (!hqBranch || !adminUser || !regularWarehouse) {
        console.warn("HQ Branch, super_admin user, or Regular Warehouse missing. Skipping demo transactions.");
        return;
    }

    // GL Accounts lookup
    const allGl = await dbInstance.select().from(glAccounts);
    const glMap: Record<string, typeof glAccounts.$inferSelect> = {};
    for (const g of allGl) {
        glMap[g.code] = g;
    }

    const cashGl = glMap["1100"];
    const bankGl = glMap["1200"];
    const arGl = glMap["1300"];
    const inventoryGl = glMap["1400"];
    const apGl = glMap["2100"];
    const salesGl = glMap["4100"];
    const otherIncomeGl = glMap["4200"];
    const cogsGl = glMap["5100"];
    const operationalExpenseGl = glMap["5220"] || glMap["5200"];

    // Contacts lookup
    const [supplier] = await dbInstance
        .select()
        .from(contacts)
        .where(eq(contacts.name, "PT Indofood CBP Sukses Makmur"))
        .limit(1);

    const [customer] = await dbInstance
        .select()
        .from(contacts)
        .where(eq(contacts.name, "PT Berkah Abadi Retail"))
        .limit(1);

    // Products & Details lookup
    const prods = await dbInstance.select().from(products);
    const details = await dbInstance.select().from(productDetails);

    const productMap: Record<string, { product: typeof products.$inferSelect; detail: typeof productDetails.$inferSelect }> = {};
    for (const p of prods) {
        const d = details.find((det) => det.productId === p.id);
        if (d) {
            productMap[p.name] = { product: p, detail: d };
        }
    }

    const mw = productMap["Mineral Water 600ml"];
    const idm = productMap["Indomie Goreng Original"];
    const um = productMap["Ultra Milk Coklat 250ml"];
    const kpa = productMap["Kopi Kapal Api Special 165g"];

    if (!mw || !idm || !um || !kpa) {
        console.warn("Sample products not found. Skipping demo transactions.");
        return;
    }

    // 2. Demo Purchase Transaction (PUR-20261001-0001)
    const purchaseInvoice = "PUR-20261001-0001";
    const [existingPurchase] = await dbInstance
        .select()
        .from(transactions)
        .where(eq(transactions.invoice, purchaseInvoice))
        .limit(1);

    const purchaseItems = [
        { prod: mw, qty: 200, unitCost: 3000, price: 3000 },
        { prod: idm, qty: 300, unitCost: 2800, price: 2800 },
        { prod: um, qty: 150, unitCost: 5500, price: 5500 },
        { prod: kpa, qty: 100, unitCost: 12000, price: 12000 },
    ];

    const purchaseSubtotal = purchaseItems.reduce((sum, item) => sum + item.qty * item.price, 0);

    let purchaseTrxId = existingPurchase?.id;

    if (!existingPurchase) {
        const [purchaseTrx] = await dbInstance
            .insert(transactions)
            .values({
                type: "purchase",
                invoice: purchaseInvoice,
                contactId: supplier?.id || null,
                date: "2026-10-01",
                termOfPayment: 30,
                reference: "PO-IND-001",
                note: "Pembelian stok awal dari supplier",
                subtotal: purchaseSubtotal,
                totalAmount: purchaseSubtotal,
                status: "posted",
                userId: adminUser.id,
                branchId: hqBranch.id,
            })
            .returning();

        purchaseTrxId = purchaseTrx.id;

        // Transaction Details
        for (const item of purchaseItems) {
            const amount = item.qty * item.price;
            await dbInstance.insert(transactionDetails).values({
                transactionId: purchaseTrx.id,
                productId: item.prod.product.id,
                productDetailId: item.prod.detail.id,
                warehouseId: regularWarehouse.id,
                movementType: 1, // In
                qty: item.qty,
                baseRatio: 1,
                price: item.price,
                unitCost: item.unitCost,
                amount: amount,
                totalCost: amount,
            });

            // Stock Table Entry
            const [existingStock] = await dbInstance
                .select()
                .from(stocks)
                .where(
                    and(
                        eq(stocks.productId, item.prod.product.id),
                        eq(stocks.warehouseId, regularWarehouse.id),
                    ),
                )
                .limit(1);

            let stockId = existingStock?.id;
            if (!existingStock) {
                const [insertedStock] = await dbInstance
                    .insert(stocks)
                    .values({
                        productId: item.prod.product.id,
                        warehouseId: regularWarehouse.id,
                        qty: item.qty,
                    })
                    .returning();
                stockId = insertedStock.id;
            } else {
                await dbInstance
                    .update(stocks)
                    .set({ qty: item.qty })
                    .where(eq(stocks.id, existingStock.id));
            }

            // Stock Movement Entry
            if (stockId) {
                const [movement] = await dbInstance
                    .insert(stockMovements)
                    .values({
                        stockId,
                        type: "IN",
                        qty: item.qty,
                        unitCost: item.unitCost,
                        transactionId: purchaseTrx.id,
                        note: `Purchase ${purchaseInvoice}`,
                    })
                    .returning();

                // Stock Layer Entry
                await dbInstance.insert(stockLayers).values({
                    stockId,
                    movementId: movement.id,
                    remainingQty: item.qty,
                    unitCost: item.unitCost,
                });
            }
        }

        // Journal Entry for Purchase
        if (inventoryGl && apGl) {
            const [purchaseJournal] = await dbInstance
                .insert(journals)
                .values({
                    invoice: purchaseInvoice,
                    transactionId: purchaseTrx.id,
                    branchId: hqBranch.id,
                    date: "2026-10-01",
                    description: `Pembelian stok ${purchaseInvoice} - ${supplier?.name || "Supplier"}`,
                    status: "posted",
                })
                .returning();

            await dbInstance.insert(journalEntries).values([
                {
                    journalId: purchaseJournal.id,
                    glAccountId: inventoryGl.id,
                    debit: purchaseSubtotal,
                    credit: 0,
                    note: "Persediaan Barang Dagang",
                },
                {
                    journalId: purchaseJournal.id,
                    glAccountId: apGl.id,
                    debit: 0,
                    credit: purchaseSubtotal,
                    note: "Hutang Usaha Supplier",
                },
            ]);
        }

        // Open Invoice for Payable
        if (supplier) {
            await dbInstance.insert(openInvoices).values({
                transactionId: purchaseTrx.id,
                contactId: supplier.id,
                branchId: hqBranch.id,
                type: "payable",
                dueDate: "2026-10-31",
                amount: purchaseSubtotal,
                paidAmount: 0,
                status: "open",
            });
        }

        console.log(`Seeded demo purchase ${purchaseInvoice} (Rp ${purchaseSubtotal.toLocaleString()})`);
    }

    // 3. Demo Sales Transaction (SLS-20261015-0001)
    const salesInvoice = "SLS-20261015-0001";
    const [existingSales] = await dbInstance
        .select()
        .from(transactions)
        .where(eq(transactions.invoice, salesInvoice))
        .limit(1);

    const salesItems = [
        { prod: mw, qty: 50, price: 5000, unitCost: 3000 },
        { prod: idm, qty: 100, price: 3500, unitCost: 2800 },
        { prod: um, qty: 30, price: 7000, unitCost: 5500 },
        { prod: kpa, qty: 20, price: 16000, unitCost: 12000 },
    ];

    const salesSubtotal = salesItems.reduce((sum, item) => sum + item.qty * item.price, 0);
    const salesTotalCost = salesItems.reduce((sum, item) => sum + item.qty * item.unitCost, 0);

    if (!existingSales) {
        const [salesTrx] = await dbInstance
            .insert(transactions)
            .values({
                type: "sales",
                invoice: salesInvoice,
                contactId: customer?.id || null,
                date: "2026-10-15",
                termOfPayment: 14,
                reference: "SO-CUST-001",
                note: "Penjualan grosir ke pelanggan retail",
                subtotal: salesSubtotal,
                totalAmount: salesSubtotal,
                status: "posted",
                userId: adminUser.id,
                branchId: hqBranch.id,
            })
            .returning();

        // Transaction Details
        for (const item of salesItems) {
            const amount = item.qty * item.price;
            const costAmount = item.qty * item.unitCost;

            await dbInstance.insert(transactionDetails).values({
                transactionId: salesTrx.id,
                productId: item.prod.product.id,
                productDetailId: item.prod.detail.id,
                warehouseId: regularWarehouse.id,
                movementType: 2, // Out
                qty: item.qty,
                baseRatio: 1,
                price: item.price,
                unitCost: item.unitCost,
                amount: amount,
                totalCost: costAmount,
            });

            // Deduct stock
            const [stock] = await dbInstance
                .select()
                .from(stocks)
                .where(
                    and(
                        eq(stocks.productId, item.prod.product.id),
                        eq(stocks.warehouseId, regularWarehouse.id),
                    ),
                )
                .limit(1);

            if (stock) {
                const newQty = Math.max(0, Number(stock.qty) - item.qty);
                await dbInstance
                    .update(stocks)
                    .set({ qty: newQty })
                    .where(eq(stocks.id, stock.id));

                await dbInstance.insert(stockMovements).values({
                    stockId: stock.id,
                    type: "OUT",
                    qty: item.qty,
                    unitCost: item.unitCost,
                    transactionId: salesTrx.id,
                    note: `Sales ${salesInvoice}`,
                });
            }
        }

        // Journal Entry for Sales & COGS
        if (arGl && salesGl && cogsGl && inventoryGl) {
            const [salesJournal] = await dbInstance
                .insert(journals)
                .values({
                    invoice: salesInvoice,
                    transactionId: salesTrx.id,
                    branchId: hqBranch.id,
                    date: "2026-10-15",
                    description: `Penjualan ${salesInvoice} - ${customer?.name || "Customer"}`,
                    status: "posted",
                })
                .returning();

            await dbInstance.insert(journalEntries).values([
                // Revenue
                {
                    journalId: salesJournal.id,
                    glAccountId: arGl.id,
                    debit: salesSubtotal,
                    credit: 0,
                    note: "Piutang Usaha Penjualan",
                },
                {
                    journalId: salesJournal.id,
                    glAccountId: salesGl.id,
                    debit: 0,
                    credit: salesSubtotal,
                    note: "Pendapatan Penjualan",
                },
                // COGS
                {
                    journalId: salesJournal.id,
                    glAccountId: cogsGl.id,
                    debit: salesTotalCost,
                    credit: 0,
                    note: "Harga Pokok Penjualan",
                },
                {
                    journalId: salesJournal.id,
                    glAccountId: inventoryGl.id,
                    debit: 0,
                    credit: salesTotalCost,
                    note: "Pengurangan Persediaan Penjualan",
                },
            ]);
        }

        // Open Invoice for Receivable
        if (customer) {
            await dbInstance.insert(openInvoices).values({
                transactionId: salesTrx.id,
                contactId: customer.id,
                branchId: hqBranch.id,
                type: "receivable",
                dueDate: "2026-10-29",
                amount: salesSubtotal,
                paidAmount: 0,
                status: "open",
            });
        }

        console.log(`Seeded demo sales ${salesInvoice} (Rp ${salesSubtotal.toLocaleString()})`);
    }

    // 4. Demo Expense (EXP-20261010-0001)
    const expenseCode = "EXP-20261010-0001";
    const [existingExpense] = await dbInstance
        .select()
        .from(expenses)
        .where(eq(expenses.code, expenseCode))
        .limit(1);

    if (!existingExpense && cashGl && operationalExpenseGl) {
        const expenseAmount = 750000;

        const [expenseJournal] = await dbInstance
            .insert(journals)
            .values({
                invoice: expenseCode,
                branchId: hqBranch.id,
                date: "2026-10-10",
                description: "Pembayaran tagihan listrik, air & internet kantor Okt 2026",
                status: "posted",
            })
            .returning();

        await dbInstance.insert(journalEntries).values([
            {
                journalId: expenseJournal.id,
                glAccountId: operationalExpenseGl.id,
                debit: expenseAmount,
                credit: 0,
                note: "Beban Listrik, Air & Internet",
            },
            {
                journalId: expenseJournal.id,
                glAccountId: cashGl.id,
                debit: 0,
                credit: expenseAmount,
                note: "Kas Operasional",
            },
        ]);

        const [exp] = await dbInstance
            .insert(expenses)
            .values({
                code: expenseCode,
                date: "2026-10-10",
                paymentAccountId: cashGl.id,
                branchId: hqBranch.id,
                userId: adminUser.id,
                totalAmount: expenseAmount,
                reference: "PLN-TELKOM-OKT",
                description: "Pembayaran tagihan listrik, air & internet kantor Okt 2026",
                status: "posted",
                journalId: expenseJournal.id,
            })
            .returning();

        await dbInstance.insert(expenseLines).values({
            expenseId: exp.id,
            glAccountId: operationalExpenseGl.id,
            amount: expenseAmount,
            note: "Listrik PLN & IndiHome",
        });

        console.log(`Seeded demo expense ${expenseCode} (Rp ${expenseAmount.toLocaleString()})`);
    }

    // 5. Demo Income (INC-20261012-0001)
    const incomeCode = "INC-20261012-0001";
    const [existingIncome] = await dbInstance
        .select()
        .from(incomes)
        .where(eq(incomes.code, incomeCode))
        .limit(1);

    if (!existingIncome && bankGl && otherIncomeGl) {
        const incomeAmount = 1500000;

        let [incomeJournal] = await dbInstance
            .select()
            .from(journals)
            .where(eq(journals.invoice, incomeCode))
            .limit(1);

        if (!incomeJournal) {
            const [createdJrl] = await dbInstance
                .insert(journals)
                .values({
                    invoice: incomeCode,
                    branchId: hqBranch.id,
                    date: "2026-10-12",
                    description: "Pendapatan jasa titip & sewa rak display Okt 2026",
                    status: "posted",
                })
                .returning();
            incomeJournal = createdJrl;

            await dbInstance.insert(journalEntries).values([
                {
                    journalId: incomeJournal.id,
                    glAccountId: bankGl.id,
                    debit: incomeAmount,
                    credit: 0,
                    note: "Bank Masuk Jasa Display",
                },
                {
                    journalId: incomeJournal.id,
                    glAccountId: otherIncomeGl.id,
                    debit: 0,
                    credit: incomeAmount,
                    note: "Pendapatan Lain-lain",
                },
            ]);
        }

        const [inc] = await dbInstance
            .insert(incomes)
            .values({
                code: incomeCode,
                date: "2026-10-12",
                depositAccountId: bankGl.id,
                branchId: hqBranch.id,
                userId: adminUser.id,
                totalAmount: incomeAmount,
                reference: "TRF-DSP-01",
                description: "Pendapatan jasa titip & sewa rak display Okt 2026",
                status: "posted",
                journalId: incomeJournal.id,
            })
            .returning();

        await dbInstance.insert(incomeLines).values({
            incomeId: inc.id,
            glAccountId: otherIncomeGl.id,
            amount: incomeAmount,
            note: "Sewa display vendor",
        });

        console.log(`Seeded demo income ${incomeCode} (Rp ${incomeAmount.toLocaleString()})`);
    }

    // 6. Demo Stock Opname (OPN-20261020-0001)
    const opnameCode = "OPN-20261020-0001";
    const [existingOpname] = await dbInstance
        .select()
        .from(stockOpnames)
        .where(eq(stockOpnames.code, opnameCode))
        .limit(1);

    if (!existingOpname) {
        const [opname] = await dbInstance
            .insert(stockOpnames)
            .values({
                code: opnameCode,
                name: "Stock Opname Bulanan Gudang Utama",
                branchId: hqBranch.id,
                warehouseId: regularWarehouse.id,
                countDate: "2026-10-20",
                status: "draft",
                note: "Pemeriksaan fisik stok akhir bulan Oktober 2026",
                createdBy: adminUser.id,
            })
            .returning();

        // Get current stock for each product
        const currentStocks = await dbInstance
            .select()
            .from(stocks)
            .where(eq(stocks.warehouseId, regularWarehouse.id));

        for (const st of currentStocks) {
            const p = prods.find((prod) => prod.id === st.productId);
            const d = details.find((det) => det.productId === st.productId);
            if (p && d) {
                const sysQty = Number(st.qty);
                await dbInstance.insert(stockOpnameItems).values({
                    stockOpnameId: opname.id,
                    productId: p.id,
                    productDetailId: d.id,
                    warehouseId: regularWarehouse.id,
                    systemQty: sysQty,
                    physicalQty: sysQty,
                    difference: 0,
                    unitCost: Number(d.cost) || 0,
                    note: "Stok fisik sesuai sistem",
                });
            }
        }

        console.log(`Seeded demo stock opname ${opnameCode}`);
    }

    // 7. Demo Bank Reconciliation (BRC-20261020-0001)
    const reconCode = "BRC-20261020-0001";
    const [existingRecon] = await dbInstance
        .select()
        .from(bankReconciliations)
        .where(eq(bankReconciliations.code, reconCode))
        .limit(1);

    if (!existingRecon && bankGl) {
        const [recon] = await dbInstance
            .insert(bankReconciliations)
            .values({
                code: reconCode,
                name: "Rekonsiliasi Bank Operasional - Okt 2026",
                bankAccountId: bankGl.id,
                reconciliationDate: "2026-10-20",
                openingBalance: 10000000,
                statementBalance: 11500000,
                clearedBalance: 11500000,
                difference: 0,
                status: "draft",
                note: "Rekonsiliasi rekening Bank BCA operasional",
                branchId: hqBranch.id,
                createdBy: adminUser.id,
            })
            .returning();

        // Find bank entries to link
        const bankEntries = await dbInstance
            .select()
            .from(journalEntries)
            .where(eq(journalEntries.glAccountId, bankGl.id))
            .limit(5);

        for (const entry of bankEntries) {
            await dbInstance.insert(bankReconciliationItems).values({
                bankReconciliationId: recon.id,
                journalEntryId: entry.id,
                transactionDate: "2026-10-12",
                reference: "INC-20261012-0001",
                description: entry.note || "Setoran bank",
                debit: Number(entry.debit) || 0,
                credit: Number(entry.credit) || 0,
                isCleared: true,
                clearedAt: new Date(),
            });
        }

        console.log(`Seeded demo bank reconciliation ${reconCode}`);
    }

    console.log("Demo transactions & operational data seeding completed successfully.");
}

// Allow running standalone via: npx tsx src/db/seeds/004_seed_demo_data.ts
if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("004_seed_demo_data.ts")) {
    seedDemoData(db)
        .then(() => process.exit(0))
        .catch((err) => {
            console.error("Demo seed failed:", err);
            process.exit(1);
        });
}

