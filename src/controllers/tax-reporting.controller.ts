import { Request, Response } from "express";
import { db } from "@/db";
import {
    accountMappings,
    branches,
    contacts,
    glAccounts,
    journalEntries,
    journals,
    products,
    settings,
    transactionDetails,
    transactions,
} from "@/db/schemas";
import {
    and,
    asc,
    desc,
    eq,
    gte,
    inArray,
    lte,
    or,
    sql,
} from "drizzle-orm";
import { branchScope } from "@/helpers/branch.helper";
import { logAction } from "@/utils/log-helper";
import {
    buildCoretaxDigunggungXml,
    buildCoretaxFakturKeluaranXml,
    computeTaxBreakdown,
    type CoretaxDigunggungEntry,
    type CoretaxKeluaranInvoice,
} from "@/helpers/coretax.helper";
import z from "zod";

const TAX_REPORTING_TYPES = [
    "sales",
    "pos_sales",
    "sales_return",
    "purchase",
    "purchase_return",
] as const;

function parsePeriodRange(req: Request) {
    const monthParam =
        typeof req.query.month === "string" ? req.query.month.trim() : "";
    const fromParam =
        typeof req.query.from === "string" ? req.query.from.trim() : "";
    const toParam =
        typeof req.query.to === "string" ? req.query.to.trim() : "";

    if (/^\d{4}-\d{2}$/.test(monthParam)) {
        const [y, m] = monthParam.split("-").map(Number);
        const lastDay = new Date(y, m, 0).getDate();
        const padM = String(m).padStart(2, "0");
        const padD = String(lastDay).padStart(2, "0");
        return {
            fromDate: `${y}-${padM}-01`,
            toDate: `${y}-${padM}-${padD}`,
            month: m,
            year: y,
            periodKey: monthParam,
        };
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(fromParam) && /^\d{4}-\d{2}-\d{2}$/.test(toParam)) {
        const [y, m] = fromParam.split("-").map(Number);
        return {
            fromDate: fromParam,
            toDate: toParam,
            month: m,
            year: y,
            periodKey: `${fromParam}_${toParam}`,
        };
    }

    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const lastDay = new Date(y, m, 0).getDate();
    const padM = String(m).padStart(2, "0");
    const padD = String(lastDay).padStart(2, "0");
    return {
        fromDate: `${y}-${padM}-01`,
        toDate: `${y}-${padM}-${padD}`,
        month: m,
        year: y,
        periodKey: `${y}-${padM}`,
    };
}

function buildEffectiveBranchFilter(column: any, req: Request) {
    const requestedBranchId =
        typeof req.query.branchId === "string" ? req.query.branchId.trim() : "";

    if (requestedBranchId && requestedBranchId !== "all") {
        if (req.isHq || requestedBranchId === (req.user as any)?.branchId) {
            return eq(column, requestedBranchId);
        }
    }
    return branchScope(column, req);
}

function finalizedTransactionStatusCondition() {
    return or(
        inArray(transactions.status, ["posted", "partial", "paid"]),
        and(
            eq(transactions.type, "pos_sales"),
            eq(transactions.status, "order"),
        ),
    );
}

export const getTaxReportingSummary = async (req: Request, res: Response) => {
    try {
        const period = parsePeriodRange(req);
        const branchCondition = buildEffectiveBranchFilter(
            transactions.branchId,
            req,
        );

        const [globalSettings] = await db
            .select()
            .from(settings)
            .where(eq(settings.id, "global"))
            .limit(1);

        const useDppNilaiLain = globalSettings?.useDppNilaiLain ?? true;

        const rawRows = await db
            .select({
                id: transactions.id,
                type: transactions.type,
                invoice: transactions.invoice,
                date: transactions.date,
                status: transactions.status,
                subtotal: transactions.subtotal,
                totalDiscount: transactions.totalDiscount,
                totalTax: transactions.totalTax,
                totalAmount: transactions.totalAmount,
                branchId: transactions.branchId,
                branchName: branches.name,
                contactId: transactions.contactId,
                contactName: contacts.name,
                contactNpwp: contacts.npwp,
                contactNitku: contacts.nitku,
                contactIsPkp: contacts.isPkp,
                contactTaxAddress: contacts.taxAddress,
                contactAddress: contacts.address,
                taxReportingMode: transactions.taxReportingMode,
                taxInvoiceCode: transactions.taxInvoiceCode,
                taxInvoiceNumber: transactions.taxInvoiceNumber,
                taxInvoiceDate: transactions.taxInvoiceDate,
                taxInvoiceStatus: transactions.taxInvoiceStatus,
            })
            .from(transactions)
            .leftJoin(contacts, eq(transactions.contactId, contacts.id))
            .leftJoin(branches, eq(transactions.branchId, branches.id))
            .where(
                and(
                    inArray(transactions.type, [...TAX_REPORTING_TYPES]),
                    finalizedTransactionStatusCondition(),
                    gte(transactions.date, period.fromDate),
                    lte(transactions.date, period.toDate),
                    branchCondition,
                ),
            )
            .orderBy(desc(transactions.date), desc(transactions.invoice));

        const summary = {
            fakturKeluaran: { count: 0, dppHargaJual: 0, dppNilaiLain: 0, ppn: 0 },
            digunggung: { count: 0, dppHargaJual: 0, dppNilaiLain: 0, ppn: 0 },
            returKeluaran: { count: 0, dppHargaJual: 0, dppNilaiLain: 0, ppn: 0 },
            netKeluaran: { dppHargaJual: 0, dppNilaiLain: 0, ppn: 0 },
            pajakMasukan: { count: 0, dppHargaJual: 0, dppNilaiLain: 0, ppn: 0 },
            returMasukan: { count: 0, dppHargaJual: 0, dppNilaiLain: 0, ppn: 0 },
            netMasukan: { dppHargaJual: 0, dppNilaiLain: 0, ppn: 0 },
            kurangLebihBayar: 0,
            nonPpnSales: { count: 0, totalAmount: 0 },
            nonPpnPurchases: { count: 0, totalAmount: 0 },
            fakturStatusCounts: {
                pending: 0,
                exported: 0,
                issued: 0,
                cancelled: 0,
            },
        };

        const rows = rawRows.map((row) => {
            const breakdown = computeTaxBreakdown(
                {
                    type: row.type,
                    subtotal: Number(row.subtotal || 0),
                    totalDiscount: Number(row.totalDiscount || 0),
                    totalTax: Number(row.totalTax || 0),
                    taxReportingMode: row.taxReportingMode,
                    taxInvoiceCode: row.taxInvoiceCode,
                    contactIsPkp: row.contactIsPkp,
                    contactNpwp: row.contactNpwp,
                },
                useDppNilaiLain,
            );

            const signedDpp = breakdown.dppHargaJual * breakdown.sign;
            const signedDppLain = breakdown.dppNilaiLain * breakdown.sign;
            const signedPpn = breakdown.ppn * breakdown.sign;
            const effectiveStatus = (row.taxInvoiceStatus || "pending") as
                | "pending"
                | "exported"
                | "issued"
                | "cancelled";

            const isSalesSide =
                row.type === "sales" ||
                row.type === "pos_sales" ||
                row.type === "sales_return";

            if (breakdown.effectiveMode === "non_ppn") {
                if (isSalesSide) {
                    summary.nonPpnSales.count += 1;
                    summary.nonPpnSales.totalAmount +=
                        Number(row.totalAmount || 0) * breakdown.sign;
                } else {
                    summary.nonPpnPurchases.count += 1;
                    summary.nonPpnPurchases.totalAmount +=
                        Number(row.totalAmount || 0) * breakdown.sign;
                }
            } else if (row.type === "sales" || row.type === "pos_sales") {
                if (breakdown.effectiveMode === "faktur_pajak") {
                    summary.fakturKeluaran.count += 1;
                    summary.fakturKeluaran.dppHargaJual += breakdown.dppHargaJual;
                    summary.fakturKeluaran.dppNilaiLain += breakdown.dppNilaiLain;
                    summary.fakturKeluaran.ppn += breakdown.ppn;

                    if (effectiveStatus in summary.fakturStatusCounts) {
                        summary.fakturStatusCounts[effectiveStatus] += 1;
                    }
                } else {
                    summary.digunggung.count += 1;
                    summary.digunggung.dppHargaJual += breakdown.dppHargaJual;
                    summary.digunggung.dppNilaiLain += breakdown.dppNilaiLain;
                    summary.digunggung.ppn += breakdown.ppn;
                }
                summary.netKeluaran.dppHargaJual += signedDpp;
                summary.netKeluaran.dppNilaiLain += signedDppLain;
                summary.netKeluaran.ppn += signedPpn;
            } else if (row.type === "sales_return") {
                summary.returKeluaran.count += 1;
                summary.returKeluaran.dppHargaJual += breakdown.dppHargaJual;
                summary.returKeluaran.dppNilaiLain += breakdown.dppNilaiLain;
                summary.returKeluaran.ppn += breakdown.ppn;

                summary.netKeluaran.dppHargaJual += signedDpp;
                summary.netKeluaran.dppNilaiLain += signedDppLain;
                summary.netKeluaran.ppn += signedPpn;
            } else if (row.type === "purchase") {
                summary.pajakMasukan.count += 1;
                summary.pajakMasukan.dppHargaJual += breakdown.dppHargaJual;
                summary.pajakMasukan.dppNilaiLain += breakdown.dppNilaiLain;
                summary.pajakMasukan.ppn += breakdown.ppn;

                summary.netMasukan.dppHargaJual += signedDpp;
                summary.netMasukan.dppNilaiLain += signedDppLain;
                summary.netMasukan.ppn += signedPpn;
            } else if (row.type === "purchase_return") {
                summary.returMasukan.count += 1;
                summary.returMasukan.dppHargaJual += breakdown.dppHargaJual;
                summary.returMasukan.dppNilaiLain += breakdown.dppNilaiLain;
                summary.returMasukan.ppn += breakdown.ppn;

                summary.netMasukan.dppHargaJual += signedDpp;
                summary.netMasukan.dppNilaiLain += signedDppLain;
                summary.netMasukan.ppn += signedPpn;
            }

            return {
                ...row,
                subtotal: Number(row.subtotal || 0),
                totalDiscount: Number(row.totalDiscount || 0),
                totalTax: Number(row.totalTax || 0),
                totalAmount: Number(row.totalAmount || 0),
                dppHargaJual: signedDpp,
                dppNilaiLain: signedDppLain,
                ppn: signedPpn,
                effectiveMode: breakdown.effectiveMode,
                effectiveTrxCode: breakdown.effectiveTrxCode,
                taxInvoiceStatus: effectiveStatus,
                taxDirection: isSalesSide ? "keluaran" : "masukan",
            };
        });

        summary.kurangLebihBayar =
            summary.netKeluaran.ppn - summary.netMasukan.ppn;

        // GL Reconciliation check against sales_tax & purchase_tax account mappings
        const taxMappings = await db
            .select({
                type: accountMappings.type,
                glAccountCode: accountMappings.glAccountCode,
            })
            .from(accountMappings)
            .where(inArray(accountMappings.type, ["sales_tax", "purchase_tax"]));

        const salesTaxCodes = Array.from(
            new Set(
                taxMappings
                    .filter((m) => m.type === "sales_tax")
                    .map((m) => m.glAccountCode),
            ),
        );
        const purchaseTaxCodes = Array.from(
            new Set(
                taxMappings
                    .filter((m) => m.type === "purchase_tax")
                    .map((m) => m.glAccountCode),
            ),
        );

        const journalBranchCond = buildEffectiveBranchFilter(
            journals.branchId,
            req,
        );

        const getGlBalanceByCodes = async (
            codes: string[],
            normalSide: "credit" | "debit",
        ) => {
            if (!codes.length) return 0;
            const [resGl] = await db
                .select({
                    debit: sql<number>`COALESCE(SUM(${journalEntries.debit}), 0)`,
                    credit: sql<number>`COALESCE(SUM(${journalEntries.credit}), 0)`,
                })
                .from(journalEntries)
                .innerJoin(journals, eq(journalEntries.journalId, journals.id))
                .innerJoin(
                    glAccounts,
                    eq(journalEntries.glAccountId, glAccounts.id),
                )
                .where(
                    and(
                        eq(journals.status, "posted"),
                        gte(journals.date, period.fromDate),
                        lte(journals.date, period.toDate),
                        inArray(glAccounts.code, codes),
                        journalBranchCond,
                    ),
                );
            const d = Number(resGl?.debit || 0);
            const c = Number(resGl?.credit || 0);
            return Math.round(normalSide === "credit" ? c - d : d - c);
        };

        const [ppnKeluaranGl, ppnMasukanGl] = await Promise.all([
            getGlBalanceByCodes(
                salesTaxCodes.length ? salesTaxCodes : ["2210"],
                "credit",
            ),
            getGlBalanceByCodes(
                purchaseTaxCodes.length ? purchaseTaxCodes : ["1500"],
                "debit",
            ),
        ]);

        return res.json({
            period,
            companyTaxProfile: {
                companyName: globalSettings?.companyName || "",
                companyNpwp: globalSettings?.companyNpwp || "",
                companyNitku: globalSettings?.companyNitku || "",
                companyTaxAddress: globalSettings?.companyTaxAddress || "",
                useDppNilaiLain,
            },
            summary,
            glReconciliation: {
                ppnKeluaranGl,
                ppnMasukanGl,
                selisihKeluaran: summary.netKeluaran.ppn - ppnKeluaranGl,
                selisihMasukan: summary.netMasukan.ppn - ppnMasukanGl,
            },
            rows,
        });
    } catch (error) {
        console.error("Error fetching tax reporting summary:", error);
        return res.status(500).json({
            message: "Gagal memuat ringkasan pelaporan pajak",
        });
    }
};

const updateTaxMetadataSchema = z.object({
    taxReportingMode: z
        .enum(["faktur_pajak", "digunggung", "non_ppn"])
        .optional()
        .nullable(),
    taxInvoiceCode: z.string().max(10).optional().nullable(),
    taxInvoiceNumber: z.string().max(64).optional().nullable(),
    taxInvoiceDate: z.string().optional().nullable(),
    taxInvoiceStatus: z
        .enum(["pending", "exported", "issued", "cancelled"])
        .optional()
        .nullable(),
});

export const updateTransactionTaxMetadata = async (
    req: Request,
    res: Response,
) => {
    const { id } = req.params;
    const parsed = updateTaxMetadataSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            message: "Data faktur pajak tidak valid",
            errors: parsed.error.issues,
        });
    }

    try {
        const [existing] = await db
            .select()
            .from(transactions)
            .where(eq(transactions.id, id))
            .limit(1);

        if (!existing) {
            return res.status(404).json({ message: "Transaksi tidak ditemukan" });
        }

        const data = parsed.data;
        const cleanNumber = data.taxInvoiceNumber?.trim() || null;
        const nextStatus =
            data.taxInvoiceStatus ||
            (cleanNumber ? "issued" : existing.taxInvoiceStatus || "pending");

        const [updated] = await db
            .update(transactions)
            .set({
                ...(data.taxReportingMode !== undefined && {
                    taxReportingMode: data.taxReportingMode,
                }),
                ...(data.taxInvoiceCode !== undefined && {
                    taxInvoiceCode: data.taxInvoiceCode?.trim() || null,
                }),
                ...(data.taxInvoiceNumber !== undefined && {
                    taxInvoiceNumber: cleanNumber,
                }),
                ...(data.taxInvoiceDate !== undefined && {
                    taxInvoiceDate: data.taxInvoiceDate || null,
                }),
                taxInvoiceStatus: nextStatus,
            })
            .where(eq(transactions.id, id))
            .returning();

        logAction(req, {
            action: "update",
            table: "transactions",
            oldData: existing,
            data: updated,
            userId: req.user!.id,
            msg: `updated tax invoice metadata for ${existing.invoice}`,
        });

        return res.json({
            message: `Metadata faktur pajak untuk ${existing.invoice} diperbarui`,
            transaction: updated,
        });
    } catch (error) {
        console.error("Error updating transaction tax metadata:", error);
        return res
            .status(500)
            .json({ message: "Gagal memperbarui data faktur pajak" });
    }
};

export const getTransactionFakturDetail = async (
    req: Request,
    res: Response,
) => {
    const { id } = req.params;
    try {
        const [txRow] = await db
            .select({
                id: transactions.id,
                type: transactions.type,
                invoice: transactions.invoice,
                date: transactions.date,
                status: transactions.status,
                subtotal: transactions.subtotal,
                totalDiscount: transactions.totalDiscount,
                totalTax: transactions.totalTax,
                totalAmount: transactions.totalAmount,
                taxReportingMode: transactions.taxReportingMode,
                taxInvoiceCode: transactions.taxInvoiceCode,
                taxInvoiceNumber: transactions.taxInvoiceNumber,
                taxInvoiceDate: transactions.taxInvoiceDate,
                taxInvoiceStatus: transactions.taxInvoiceStatus,
                contactName: contacts.name,
                contactAddress: contacts.address,
                contactTaxAddress: contacts.taxAddress,
                contactNpwp: contacts.npwp,
                contactNitku: contacts.nitku,
                contactIsPkp: contacts.isPkp,
                contactEmail: contacts.email,
                branchName: branches.name,
                branchAddress: branches.address,
            })
            .from(transactions)
            .leftJoin(contacts, eq(transactions.contactId, contacts.id))
            .leftJoin(branches, eq(transactions.branchId, branches.id))
            .where(eq(transactions.id, id))
            .limit(1);

        if (!txRow) {
            return res.status(404).json({ message: "Transaksi tidak ditemukan" });
        }

        const [globalSettings] = await db
            .select()
            .from(settings)
            .where(eq(settings.id, "global"))
            .limit(1);

        const useDppNilaiLain = globalSettings?.useDppNilaiLain ?? true;
        const breakdown = computeTaxBreakdown(
            {
                type: txRow.type,
                subtotal: Number(txRow.subtotal || 0),
                totalDiscount: Number(txRow.totalDiscount || 0),
                totalTax: Number(txRow.totalTax || 0),
                taxReportingMode: txRow.taxReportingMode,
                taxInvoiceCode: txRow.taxInvoiceCode,
                contactIsPkp: txRow.contactIsPkp,
                contactNpwp: txRow.contactNpwp,
            },
            useDppNilaiLain,
        );

        const cleanItems = await db
            .select({
                id: transactionDetails.id,
                productName: products.name,
                qty: transactionDetails.qty,
                price: transactionDetails.price,
                discount: transactionDetails.discount,
                amount: transactionDetails.amount,
                taxRate: transactionDetails.taxRate,
            })
            .from(transactionDetails)
            .innerJoin(products, eq(transactionDetails.productId, products.id))
            .where(eq(transactionDetails.transactionId, id));

        return res.json({
            transaction: {
                ...txRow,
                subtotal: Number(txRow.subtotal || 0),
                totalDiscount: Number(txRow.totalDiscount || 0),
                totalTax: Number(txRow.totalTax || 0),
                totalAmount: Number(txRow.totalAmount || 0),
                ...breakdown,
            },
            company: {
                name: globalSettings?.companyName || txRow.branchName || "PKP Penjual",
                npwp: globalSettings?.companyNpwp || "",
                nitku: globalSettings?.companyNitku || "",
                address:
                    globalSettings?.companyTaxAddress ||
                    txRow.branchAddress ||
                    "-",
                useDppNilaiLain,
            },
            items: cleanItems.map((it) => {
                const lineSubtotal = Number(it.amount || 0);
                const lineDpp = Math.round(lineSubtotal);
                const rate = Number(it.taxRate || 0);
                const linePpn =
                    rate > 0 ? Math.round((lineDpp * rate) / 100) : 0;
                const lineDppNilaiLain =
                    rate > 0 && useDppNilaiLain
                        ? Math.round((lineDpp * 11) / 12)
                        : lineDpp;
                return {
                    ...it,
                    qty: Number(it.qty || 0),
                    price: Number(it.price || 0),
                    discount: Number(it.discount || 0),
                    amount: lineSubtotal,
                    taxRate: rate,
                    dppHargaJual: lineDpp,
                    dppNilaiLain: lineDppNilaiLain,
                    ppn: linePpn,
                };
            }),
        });
    } catch (error) {
        console.error("Error fetching faktur detail:", error);
        return res
            .status(500)
            .json({ message: "Gagal memuat detail faktur pajak" });
    }
};

export const exportCoretaxFakturKeluaranXml = async (
    req: Request,
    res: Response,
) => {
    try {
        const period = parsePeriodRange(req);
        const branchCondition = buildEffectiveBranchFilter(
            transactions.branchId,
            req,
        );
        const idsParam =
            typeof req.query.ids === "string"
                ? req.query.ids
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean)
                : [];
        const markExported = req.query.preview !== "true";

        const [globalSettings] = await db
            .select()
            .from(settings)
            .where(eq(settings.id, "global"))
            .limit(1);

        const useDppNilaiLain = globalSettings?.useDppNilaiLain ?? true;

        const candidates = await db
            .select({
                id: transactions.id,
                type: transactions.type,
                invoice: transactions.invoice,
                date: transactions.date,
                subtotal: transactions.subtotal,
                totalDiscount: transactions.totalDiscount,
                totalTax: transactions.totalTax,
                taxReportingMode: transactions.taxReportingMode,
                taxInvoiceCode: transactions.taxInvoiceCode,
                taxInvoiceDate: transactions.taxInvoiceDate,
                taxInvoiceStatus: transactions.taxInvoiceStatus,
                contactName: contacts.name,
                contactNpwp: contacts.npwp,
                contactNitku: contacts.nitku,
                contactIsPkp: contacts.isPkp,
                contactTaxAddress: contacts.taxAddress,
                contactAddress: contacts.address,
                contactEmail: contacts.email,
            })
            .from(transactions)
            .leftJoin(contacts, eq(transactions.contactId, contacts.id))
            .where(
                and(
                    inArray(transactions.type, ["sales", "pos_sales"]),
                    finalizedTransactionStatusCondition(),
                    gte(transactions.date, period.fromDate),
                    lte(transactions.date, period.toDate),
                    branchCondition,
                    idsParam.length > 0
                        ? inArray(transactions.id, idsParam)
                        : undefined,
                ),
            )
            .orderBy(asc(transactions.date), asc(transactions.invoice));

        const targetTxs = candidates.filter((tx) => {
            if ((tx.taxInvoiceStatus || "pending") === "cancelled") {
                return false;
            }
            const breakdown = computeTaxBreakdown(
                {
                    type: tx.type,
                    subtotal: Number(tx.subtotal || 0),
                    totalDiscount: Number(tx.totalDiscount || 0),
                    totalTax: Number(tx.totalTax || 0),
                    taxReportingMode: tx.taxReportingMode,
                    taxInvoiceCode: tx.taxInvoiceCode,
                    contactIsPkp: tx.contactIsPkp,
                    contactNpwp: tx.contactNpwp,
                },
                useDppNilaiLain,
            );
            return breakdown.effectiveMode === "faktur_pajak" && breakdown.ppn > 0;
        });

        if (targetTxs.length === 0) {
            return res.status(400).json({
                message:
                    "Tidak ada transaksi Faktur Pajak Keluaran (B2B) yang memenuhi syarat di periode ini.",
            });
        }

        const txIds = targetTxs.map((t) => t.id);
        const allItems = await db
            .select({
                transactionId: transactionDetails.transactionId,
                productName: products.name,
                qty: transactionDetails.qty,
                price: transactionDetails.price,
                discount: transactionDetails.discount,
                amount: transactionDetails.amount,
                taxRate: transactionDetails.taxRate,
            })
            .from(transactionDetails)
            .innerJoin(products, eq(transactionDetails.productId, products.id))
            .where(inArray(transactionDetails.transactionId, txIds));

        const itemsByTx = new Map<string, typeof allItems>();
        for (const item of allItems) {
            const list = itemsByTx.get(item.transactionId) || [];
            list.push(item);
            itemsByTx.set(item.transactionId, list);
        }

        const invoicesForXml: CoretaxKeluaranInvoice[] = targetTxs.map((tx) => {
            const breakdown = computeTaxBreakdown(
                {
                    type: tx.type,
                    subtotal: Number(tx.subtotal || 0),
                    totalDiscount: Number(tx.totalDiscount || 0),
                    totalTax: Number(tx.totalTax || 0),
                    taxReportingMode: tx.taxReportingMode,
                    taxInvoiceCode: tx.taxInvoiceCode,
                    contactIsPkp: tx.contactIsPkp,
                    contactNpwp: tx.contactNpwp,
                },
                useDppNilaiLain,
            );

            const rawDetails = itemsByTx.get(tx.id) || [];
            const lineItems = rawDetails.map((d) => {
                const qty = Number(d.qty || 1);
                const discount = Number(d.discount || 0);
                const netAmount = Math.max(0, Number(d.amount || 0));
                const taxRate = Number(d.taxRate || 0);
                const dppNilaiLain =
                    taxRate > 0 && useDppNilaiLain
                        ? Math.round((netAmount * 11) / 12)
                        : Math.round(netAmount);
                const ppn =
                    taxRate > 0 ? Math.round((netAmount * taxRate) / 100) : 0;

                return {
                    name: d.productName,
                    unit: "UM.0018",
                    price: Number(d.price || 0),
                    qty,
                    discount,
                    dppHargaJual: Math.round(netAmount),
                    dppNilaiLain,
                    ppn,
                    taxRate,
                };
            });

            return {
                invoice: tx.invoice,
                date: tx.date,
                taxInvoiceDate: tx.taxInvoiceDate,
                trxCode: breakdown.effectiveTrxCode,
                refDesc: tx.invoice,
                buyerName: tx.contactName || "Pembeli",
                buyerNpwp: tx.contactNpwp,
                buyerNitku: tx.contactNitku,
                buyerAddress: tx.contactTaxAddress || tx.contactAddress,
                buyerEmail: tx.contactEmail,
                items: lineItems,
            };
        });

        const xml = buildCoretaxFakturKeluaranXml({
            sellerTin: globalSettings?.companyNpwp || "",
            sellerNitku: globalSettings?.companyNitku,
            useDppNilaiLain,
            invoices: invoicesForXml,
        });

        if (markExported) {
            const pendingIds = targetTxs
                .filter((t) => (t.taxInvoiceStatus || "pending") === "pending")
                .map((t) => t.id);
            if (pendingIds.length > 0) {
                await db
                    .update(transactions)
                    .set({ taxInvoiceStatus: "exported" })
                    .where(inArray(transactions.id, pendingIds));
            }
        }

        res.setHeader("Content-Type", "application/xml; charset=utf-8");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="coretax-faktur-keluaran-${period.periodKey}.xml"`,
        );
        return res.status(200).send(xml);
    } catch (error) {
        console.error("Error exporting Coretax keluaran XML:", error);
        return res
            .status(500)
            .json({ message: "Gagal mengekspor XML Faktur Pajak Keluaran" });
    }
};

export const exportCoretaxDigunggungXml = async (
    req: Request,
    res: Response,
) => {
    try {
        const period = parsePeriodRange(req);
        const branchCondition = buildEffectiveBranchFilter(
            transactions.branchId,
            req,
        );

        const [globalSettings] = await db
            .select()
            .from(settings)
            .where(eq(settings.id, "global"))
            .limit(1);

        const useDppNilaiLain = globalSettings?.useDppNilaiLain ?? true;

        const candidates = await db
            .select({
                id: transactions.id,
                type: transactions.type,
                invoice: transactions.invoice,
                date: transactions.date,
                subtotal: transactions.subtotal,
                totalDiscount: transactions.totalDiscount,
                totalTax: transactions.totalTax,
                taxReportingMode: transactions.taxReportingMode,
                taxInvoiceCode: transactions.taxInvoiceCode,
                contactName: contacts.name,
                contactNpwp: contacts.npwp,
                contactIsPkp: contacts.isPkp,
            })
            .from(transactions)
            .leftJoin(contacts, eq(transactions.contactId, contacts.id))
            .where(
                and(
                    inArray(transactions.type, ["sales", "pos_sales", "sales_return"]),
                    finalizedTransactionStatusCondition(),
                    gte(transactions.date, period.fromDate),
                    lte(transactions.date, period.toDate),
                    branchCondition,
                ),
            )
            .orderBy(asc(transactions.date), asc(transactions.invoice));

        const entries: CoretaxDigunggungEntry[] = [];
        for (const tx of candidates) {
            const breakdown = computeTaxBreakdown(
                {
                    type: tx.type,
                    subtotal: Number(tx.subtotal || 0),
                    totalDiscount: Number(tx.totalDiscount || 0),
                    totalTax: Number(tx.totalTax || 0),
                    taxReportingMode: tx.taxReportingMode,
                    taxInvoiceCode: tx.taxInvoiceCode,
                    contactIsPkp: tx.contactIsPkp,
                    contactNpwp: tx.contactNpwp,
                },
                useDppNilaiLain,
            );
            if (breakdown.effectiveMode !== "digunggung" || breakdown.ppn <= 0) {
                continue;
            }
            entries.push({
                invoice: tx.invoice,
                date: tx.date,
                trxCode: breakdown.sign === -1 ? "Return" : "Normal",
                buyerName: tx.contactName || "-",
                buyerNpwp: tx.contactNpwp,
                dppHargaJual: breakdown.dppHargaJual * breakdown.sign,
                dppNilaiLain: breakdown.dppNilaiLain * breakdown.sign,
                ppn: breakdown.ppn * breakdown.sign,
            });
        }

        if (entries.length === 0) {
            return res.status(400).json({
                message:
                    "Tidak ada transaksi PPN Digunggung (Retail/POS) pada periode ini.",
            });
        }

        const xml = buildCoretaxDigunggungXml({
            sellerTin: globalSettings?.companyNpwp || "",
            taxPeriodMonth: period.month,
            taxPeriodYear: period.year,
            entries,
        });

        res.setHeader("Content-Type", "application/xml; charset=utf-8");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="coretax-digunggung-IA5-${period.periodKey}.xml"`,
        );
        return res.status(200).send(xml);
    } catch (error) {
        console.error("Error exporting Coretax digunggung XML:", error);
        return res
            .status(500)
            .json({ message: "Gagal mengekspor XML Digunggung Coretax" });
    }
};
