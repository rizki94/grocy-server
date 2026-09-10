import { db } from "@/db";
import {
    productDetailPrices,
    productDetails,
    products,
    productUnits,
    priceGroups,
    taxes,
} from "@/db/schemas";
import { logAction } from "@/utils/log-helper";
import { eq } from "drizzle-orm";
import { Request, Response } from "express";
import ExcelJS from "exceljs";
import multer from "multer";

// Memory storage for import file (no disk write needed)
export const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PreviewRow {
    rowIndex: number;
    name: string;
    sku_id: string;
    unit_name: string;
    level: number;
    ratio: number;
    cost?: number;
    status: "valid" | "error";
    errors: string[];
    // resolved
    unitId?: string;
    taxId?: string;
    prices?: Array<{ priceGroupId: string; price: number }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cellStr(cell: ExcelJS.Cell): string {
    const v = cell.value;
    if (v == null) return "";
    if (typeof v === "object" && "richText" in v) {
        return (v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join("").trim();
    }
    return String(v).trim();
}

function cellNum(cell: ExcelJS.Cell): number | undefined {
    const v = cell.value;
    if (v == null || v === "") return undefined;
    const n = Number(v);
    return isNaN(n) ? undefined : n;
}

function cellBool(cell: ExcelJS.Cell, defaultVal: boolean): boolean {
    const v = cell.value;
    if (v == null || v === "") return defaultVal;
    if (typeof v === "boolean") return v;
    const s = String(v).toLowerCase().trim();
    if (s === "true" || s === "yes" || s === "1") return true;
    if (s === "false" || s === "no" || s === "0") return false;
    return defaultVal;
}

// ─── Raw Row ──────────────────────────────────────────────────────────────────

interface RawRow {
    rowIndex: number;
    name: string;
    description: string;
    tax_name: string;
    is_active: boolean;
    use_batch: boolean;
    use_expiry: boolean;
    use_serial_number: boolean;
    reorder_level: number;
    sku_id: string;
    barcode: string;
    unit_name: string;
    level: number;
    ratio: number;
    cost: number;
    is_sellable: boolean;
    is_default: boolean;
    /** price_<priceGroupName> columns, keyed by group name lowercase */
    pricesByGroup: Record<string, number>;
}

function parseWorksheet(
    worksheet: ExcelJS.Worksheet,
    priceGroupNames: string[]
): RawRow[] {
    const rows: RawRow[] = [];
    let headerMap: Record<string, number> = {};

    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) {
            row.eachCell((cell, colNumber) => {
                const key = cellStr(cell).toLowerCase().replace(/\s+/g, "_");
                headerMap[key] = colNumber;
            });
            return;
        }

        const get = (key: string) => {
            const col = headerMap[key];
            return col ? row.getCell(col) : ({ value: null } as unknown as ExcelJS.Cell);
        };

        const name = cellStr(get("name"));
        const sku_id = cellStr(get("sku_id"));
        if (!name && !sku_id) return; // skip empty rows

        // Parse dynamic price columns
        const pricesByGroup: Record<string, number> = {};
        for (const pgName of priceGroupNames) {
            const colKey = `price_${pgName.toLowerCase().replace(/\s+/g, "_")}`;
            const val = cellNum(get(colKey));
            if (val !== undefined) pricesByGroup[pgName.toLowerCase()] = val;
        }
        // Also scan any header starting with "price_" not in the fixed list
        for (const [headerKey, colNum] of Object.entries(headerMap)) {
            if (headerKey.startsWith("price_") && headerKey !== "price_group") {
                const pgName = headerKey.replace(/^price_/, "").replace(/_/g, " ");
                if (!(pgName in pricesByGroup)) {
                    const val = cellNum(row.getCell(colNum));
                    if (val !== undefined) pricesByGroup[pgName] = val;
                }
            }
        }

        rows.push({
            rowIndex: rowNumber,
            name,
            description: cellStr(get("description")),
            tax_name: cellStr(get("tax_name")),
            is_active: cellBool(get("is_active"), true),
            use_batch: cellBool(get("use_batch"), false),
            use_expiry: cellBool(get("use_expiry"), false),
            use_serial_number: cellBool(get("use_serial_number"), false),
            reorder_level: cellNum(get("reorder_level")) ?? 0,
            sku_id,
            barcode: cellStr(get("barcode")),
            unit_name: cellStr(get("unit_name")),
            level: cellNum(get("level")) ?? 0,
            ratio: cellNum(get("ratio")) ?? 1,
            cost: cellNum(get("cost")) ?? 0,
            is_sellable: cellBool(get("is_sellable"), true),
            is_default: cellBool(get("is_default"), false),
            pricesByGroup,
        });
    });

    return rows;
}

// ─── Template Download ────────────────────────────────────────────────────────

export const downloadProductTemplate = async (_req: Request, res: Response) => {
    try {
        // Fetch price groups for dynamic columns
        const allPriceGroups = await db
            .select({ id: priceGroups.id, name: priceGroups.name })
            .from(priceGroups)
            .where(eq(priceGroups.isActive, true));

        const workbook = new ExcelJS.Workbook();
        workbook.creator = "Grocy";

        const buildHeaders = () => {
            const base = [
                { header: "name", note: "Product name (required, unique). Repeat same name for each unit row." },
                { header: "description", note: "Optional product description." },
                { header: "tax_name", note: "Tax name (optional). Must match an existing tax." },
                { header: "is_active", note: "TRUE or FALSE (default: TRUE)." },
                { header: "use_batch", note: "TRUE or FALSE (default: FALSE)." },
                { header: "use_expiry", note: "TRUE or FALSE (default: FALSE)." },
                { header: "use_serial_number", note: "TRUE or FALSE (default: FALSE)." },
                { header: "reorder_level", note: "Reorder level quantity (default: 0)." },
                { header: "sku_id", note: "SKU ID (required, unique per row)." },
                { header: "barcode", note: "Barcode (optional, unique)." },
                { header: "unit_name", note: "Unit name (required). Must match an existing unit (e.g. Pcs, Box, Kg)." },
                { header: "level", note: "Unit level: 0 = base/smallest unit, 1 = next larger, etc." },
                { header: "ratio", note: "How many of the PREVIOUS level fit in this unit. Base unit (level 0) must be 1." },
                { header: "cost", note: "Purchase cost (default: 0)." },
                { header: "is_sellable", note: "TRUE or FALSE (default: TRUE)." },
                { header: "is_default", note: "TRUE or FALSE. Mark one unit per product as default." },
            ];
            // Append one column per price group
            for (const pg of allPriceGroups) {
                const colKey = `price_${pg.name.toLowerCase().replace(/\s+/g, "_")}`;
                base.push({ header: colKey, note: `Selling price for "${pg.name}" price group (optional, default 0).` });
            }
            return base;
        };

        const headers = buildHeaders();

        const applyHeader = (ws: ExcelJS.Worksheet) => {
            const headerRow = ws.addRow(headers.map((h) => h.header));
            headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
            headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E40AF" } };
            headerRow.height = 20;
            headers.forEach((h, i) => {
                const cell = headerRow.getCell(i + 1);
                cell.note = h.note;
                ws.getColumn(i + 1).width = Math.max(h.header.length + 4, 16);
            });
            ws.views = [{ state: "frozen", ySplit: 1 }];
        };

        // ── Sheet 1: Template ──
        const ws = workbook.addWorksheet("Template");
        applyHeader(ws);

        // ── Sheet 2: Example ──
        const ws2 = workbook.addWorksheet("Example");
        applyHeader(ws2);

        // Build example prices array (one value per price group)
        const examplePrices1 = allPriceGroups.map((_, i) => (i === 0 ? 15000 : i === 1 ? 14000 : 13500));
        const examplePrices2 = allPriceGroups.map((_, i) => (i === 0 ? 750000 : i === 1 ? 700000 : 680000));
        const examplePrices3 = allPriceGroups.map((_, i) => (i === 0 ? 18000 : i === 1 ? 17000 : 16500));
        const emptyPrices = allPriceGroups.map(() => "");

        // Sugar — 2 units
        ws2.addRow(["Sugar", "White refined sugar", "PPN 11%", true, false, false, false, 10, "SGR-KG", "8991234567", "Kg", 0, 1, 12000, true, true, ...examplePrices1]);
        ws2.addRow(["Sugar", "", "", "", "", "", "", "", "SGR-SACK", "", "Sack 50kg", 1, 50, 600000, true, false, ...examplePrices2]);
        // Cooking Oil — 1 unit
        ws2.addRow(["Cooking Oil", "Palm oil 1L", "", true, false, false, false, 5, "CO-1L", "8997654321", "Pcs", 0, 1, 15000, true, true, ...examplePrices3]);
        // Mineral Water — 3 units
        ws2.addRow(["Mineral Water", "600ml bottle", "", true, false, true, false, 20, "MW-BTL", "", "Pcs", 0, 1, 2500, true, true, ...emptyPrices]);
        ws2.addRow(["Mineral Water", "", "", "", "", "", "", "", "MW-DUS12", "", "Box 12", 1, 12, 30000, true, false, ...emptyPrices]);
        ws2.addRow(["Mineral Water", "", "", "", "", "", "", "", "MW-SHRINK", "", "Shrink 4x12", 2, 4, 120000, false, false, ...emptyPrices]);

        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", "attachment; filename=product_import_template.xlsx");
        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        console.error("downloadProductTemplate error:", err);
        res.status(500).json({ message: "Failed to generate template" });
    }
};

// ─── Preview Import ───────────────────────────────────────────────────────────

export const previewProductImport = async (req: Request, res: Response) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: "No file uploaded" });
        }

        // Fetch lookup tables
        const [allUnits, allTaxes, allPriceGroupsDb, allProducts, allDetails] = await Promise.all([
            db.select({ id: productUnits.id, name: productUnits.name, abbreviation: productUnits.abbreviation }).from(productUnits),
            db.select({ id: taxes.id, name: taxes.name }).from(taxes),
            db.select({ id: priceGroups.id, name: priceGroups.name }).from(priceGroups).where(eq(priceGroups.isActive, true)),
            db.select({ id: products.id, name: products.name }).from(products),
            db.select({ id: productDetails.id, skuId: productDetails.skuId }).from(productDetails),
        ]);

        const unitMap = new Map(allUnits.map((u) => [u.name.toLowerCase(), u]));
        const unitAbbrevMap = new Map(allUnits.map((u) => [u.abbreviation.toLowerCase(), u]));
        const taxMap = new Map(allTaxes.map((t) => [t.name.toLowerCase(), t]));
        const priceGroupMap = new Map(allPriceGroupsDb.map((pg) => [pg.name.toLowerCase(), pg]));
        const existingProductNames = new Set(allProducts.map((p) => p.name.toLowerCase()));
        const existingSkuIds = new Set(allDetails.map((d) => d.skuId.toLowerCase()));

        // Parse file
        const workbook = new ExcelJS.Workbook();
        const arrayBuffer = req.file.buffer.buffer.slice(
            req.file.buffer.byteOffset,
            req.file.buffer.byteOffset + req.file.buffer.byteLength
        );
        await workbook.xlsx.load(arrayBuffer as ArrayBuffer);

        const worksheet = workbook.worksheets[0];
        if (!worksheet) {
            return res.status(400).json({ message: "No worksheet found in file" });
        }

        const rawRows = parseWorksheet(worksheet, allPriceGroupsDb.map((pg) => pg.name));
        if (rawRows.length === 0) {
            return res.status(400).json({ message: "No data rows found" });
        }

        // Track within-file duplicates
        const seenSkuIds = new Set<string>();
        const seenProductNames = new Set<string>();

        const previewRows: PreviewRow[] = [];

        for (const raw of rawRows) {
            const errors: string[] = [];

            // Required fields
            if (!raw.name) errors.push("Product name is required");
            if (!raw.sku_id) errors.push("sku_id is required");
            if (!raw.unit_name) errors.push("unit_name is required");

            // Level/ratio
            if (raw.level === 0 && raw.ratio !== 1) {
                errors.push(`Base unit (level 0) must have ratio = 1, got ${raw.ratio}`);
            }
            if (raw.ratio < 1) errors.push("ratio must be >= 1");

            // Resolve unit
            const unitKey = raw.unit_name.toLowerCase();
            const resolvedUnit = unitMap.get(unitKey) || unitAbbrevMap.get(unitKey);
            if (raw.unit_name && !resolvedUnit) {
                errors.push(`Unit "${raw.unit_name}" not found`);
            }

            // Resolve tax
            let taxId: string | undefined;
            if (raw.tax_name) {
                const resolvedTax = taxMap.get(raw.tax_name.toLowerCase());
                if (!resolvedTax) {
                    errors.push(`Tax "${raw.tax_name}" not found`);
                } else {
                    taxId = resolvedTax.id;
                }
            }

            // Resolve prices
            const resolvedPrices: Array<{ priceGroupId: string; price: number }> = [];
            for (const [pgNameLower, price] of Object.entries(raw.pricesByGroup)) {
                const pg = priceGroupMap.get(pgNameLower);
                if (pg) {
                    resolvedPrices.push({ priceGroupId: pg.id, price });
                } else {
                    errors.push(`Price group "${pgNameLower}" not found`);
                }
            }

            // SKU duplicates
            const skuKey = raw.sku_id.toLowerCase();
            if (seenSkuIds.has(skuKey)) {
                errors.push(`Duplicate sku_id "${raw.sku_id}" within file`);
            } else {
                seenSkuIds.add(skuKey);
            }
            if (existingSkuIds.has(skuKey)) {
                errors.push(`sku_id "${raw.sku_id}" already exists in database`);
            }

            // Product name already in DB
            const nameKey = raw.name.toLowerCase();
            if (existingProductNames.has(nameKey) && !seenProductNames.has(nameKey)) {
                errors.push(`Product "${raw.name}" already exists in database`);
            }
            seenProductNames.add(nameKey);

            previewRows.push({
                rowIndex: raw.rowIndex,
                name: raw.name,
                sku_id: raw.sku_id,
                unit_name: raw.unit_name,
                level: raw.level,
                ratio: raw.ratio,
                cost: raw.cost,
                status: errors.length > 0 ? "error" : "valid",
                errors,
                unitId: resolvedUnit?.id,
                taxId,
                prices: resolvedPrices,
            });
        }

        const validCount = previewRows.filter((r) => r.status === "valid").length;
        const errorCount = previewRows.filter((r) => r.status === "error").length;
        const productCount = new Set(previewRows.filter((r) => r.status === "valid").map((r) => r.name)).size;

        // Enrich rawRows with resolved ids for import
        const enrichedRawRows = rawRows
            .filter((r) => previewRows.find((p) => p.rowIndex === r.rowIndex && p.status === "valid"))
            .map((r) => {
                const preview = previewRows.find((p) => p.rowIndex === r.rowIndex)!;
                return {
                    name: r.name,
                    description: r.description || undefined,
                    taxId: preview.taxId,
                    is_active: r.is_active,
                    use_batch: r.use_batch,
                    use_expiry: r.use_expiry,
                    use_serial_number: r.use_serial_number,
                    reorder_level: r.reorder_level,
                    sku_id: r.sku_id,
                    barcode: r.barcode || undefined,
                    unitId: preview.unitId!,
                    level: r.level,
                    ratio: r.ratio,
                    cost: r.cost,
                    is_sellable: r.is_sellable,
                    is_default: r.is_default,
                    prices: preview.prices,
                };
            });

        return res.json({
            rows: previewRows,
            summary: { totalRows: previewRows.length, validRows: validCount, errorRows: errorCount, productCount },
            rawRows: enrichedRawRows,
            priceGroups: allPriceGroupsDb,
        });
    } catch (err) {
        console.error("previewProductImport error:", err);
        return res.status(500).json({ message: "Failed to parse file", error: (err as Error).message });
    }
};

// ─── Execute Import ───────────────────────────────────────────────────────────

interface ImportRow {
    name: string;
    description?: string;
    taxId?: string;
    is_active: boolean;
    use_batch: boolean;
    use_expiry: boolean;
    use_serial_number: boolean;
    reorder_level: number;
    sku_id: string;
    barcode?: string;
    unitId: string;
    level: number;
    ratio: number;
    cost: number;
    is_sellable: boolean;
    is_default: boolean;
    prices?: Array<{ priceGroupId: string; price: number }>;
}

export const importProducts = async (req: Request, res: Response) => {
    try {
        const { rows }: { rows: ImportRow[] } = req.body;

        if (!Array.isArray(rows) || rows.length === 0) {
            return res.status(400).json({ message: "No rows to import" });
        }

        const invalid = rows.filter((r) => !r.unitId || !r.name || !r.sku_id);
        if (invalid.length > 0) {
            return res.status(400).json({ message: "Some rows are missing required fields", invalid });
        }

        // Group by product name
        const grouped = new Map<string, ImportRow[]>();
        for (const row of rows) {
            if (!grouped.has(row.name)) grouped.set(row.name, []);
            grouped.get(row.name)!.push(row);
        }

        const createdIds: string[] = [];

        await db.transaction(async (tx) => {
            for (const [productName, detailRows] of grouped) {
                detailRows.sort((a, b) => a.level - b.level);
                const firstRow = detailRows[0];

                // Insert product
                const [createdProduct] = await tx
                    .insert(products)
                    .values({
                        name: productName,
                        description: firstRow.description || undefined,
                        isActive: firstRow.is_active,
                        taxId: firstRow.taxId || null,
                        useBatch: firstRow.use_batch,
                        useExpiry: firstRow.use_expiry,
                        useSerialNumber: firstRow.use_serial_number,
                        reorderLevel: firstRow.reorder_level,
                    })
                    .returning();

                // Compute baseRatio cumulatively
                let cumulativeRatio = 1;
                const baseRatioMap = new Map<number, number>();
                for (const dr of detailRows) {
                    cumulativeRatio = dr.level === 0 ? 1 : cumulativeRatio * dr.ratio;
                    baseRatioMap.set(dr.level, cumulativeRatio);
                }

                // Insert details + prices
                for (const dr of detailRows) {
                    const [createdDetail] = await tx
                        .insert(productDetails)
                        .values({
                            productId: createdProduct.id,
                            unitId: dr.unitId,
                            skuId: dr.sku_id,
                            barcode: dr.barcode || null,
                            level: dr.level,
                            ratio: dr.ratio,
                            baseRatio: baseRatioMap.get(dr.level) ?? 1,
                            cost: dr.cost,
                            isSellable: dr.is_sellable,
                            isDefault: dr.is_default,
                        })
                        .returning();

                    // Insert price group prices
                    if (dr.prices && dr.prices.length > 0) {
                        await tx.insert(productDetailPrices).values(
                            dr.prices.map((p) => ({
                                productDetailId: createdDetail.id,
                                priceGroupId: p.priceGroupId,
                                price: p.price,
                            }))
                        );
                    }
                }

                createdIds.push(createdProduct.id);
            }
        });

        logAction(req, {
            action: "insert",
            table: "products",
            data: { importedCount: createdIds.length, productIds: createdIds },
            userId: req.user!.id,
            msg: `Batch imported ${createdIds.length} products via Excel`,
        });

        return res.status(201).json({
            message: `Successfully imported ${createdIds.length} products`,
            productIds: createdIds,
            count: createdIds.length,
        });
    } catch (err) {
        console.error("importProducts error:", err);
        return res.status(500).json({ message: "Import failed", error: (err as Error).message });
    }
};
