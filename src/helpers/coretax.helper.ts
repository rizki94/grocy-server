export type TaxReportingMode = "faktur_pajak" | "digunggung" | "non_ppn";
export type TaxInvoiceStatus = "pending" | "exported" | "issued" | "cancelled";

export interface TaxCalculationInput {
    type: string;
    subtotal: number;
    totalDiscount: number;
    totalTax: number;
    taxReportingMode?: string | null;
    taxInvoiceCode?: string | null;
    contactIsPkp?: boolean | null;
    contactNpwp?: string | null;
}

export interface TaxBreakdown {
    dppHargaJual: number;
    dppNilaiLain: number;
    ppn: number;
    effectiveMode: TaxReportingMode;
    effectiveTrxCode: string;
    sign: 1 | -1;
}

export function resolveTaxReportingMode(input: {
    type: string;
    totalTax: number;
    taxReportingMode?: string | null;
    contactIsPkp?: boolean | null;
    contactNpwp?: string | null;
}): TaxReportingMode {
    const explicit = input.taxReportingMode;
    if (
        explicit === "faktur_pajak" ||
        explicit === "digunggung" ||
        explicit === "non_ppn"
    ) {
        return explicit;
    }

    if (Math.abs(Number(input.totalTax || 0)) < 0.01) {
        return "non_ppn";
    }

    if (input.type === "pos_sales") {
        return "digunggung";
    }

    if (input.type === "purchase" || input.type === "purchase_return") {
        return "faktur_pajak";
    }

    const hasTaxIdentity = Boolean(
        input.contactIsPkp || (input.contactNpwp && input.contactNpwp.trim() !== ""),
    );
    return hasTaxIdentity ? "faktur_pajak" : "digunggung";
}

export function computeTaxBreakdown(
    input: TaxCalculationInput,
    useDppNilaiLain: boolean,
): TaxBreakdown {
    const sign: 1 | -1 =
        input.type === "sales_return" || input.type === "purchase_return"
            ? -1
            : 1;

    const rawDpp = Math.max(
        0,
        Number(input.subtotal || 0) - Number(input.totalDiscount || 0),
    );
    const rawPpn = Math.max(0, Number(input.totalTax || 0));

    const effectiveMode = resolveTaxReportingMode({
        type: input.type,
        totalTax: rawPpn,
        taxReportingMode: input.taxReportingMode,
        contactIsPkp: input.contactIsPkp,
        contactNpwp: input.contactNpwp,
    });

    const dppHargaJual = Math.round(rawDpp);
    const ppn = Math.round(rawPpn);
    const dppNilaiLain =
        ppn > 0 && useDppNilaiLain
            ? Math.round((dppHargaJual * 11) / 12)
            : dppHargaJual;

    const effectiveTrxCode =
        (input.taxInvoiceCode && input.taxInvoiceCode.trim()) ||
        (useDppNilaiLain ? "04" : "01");

    return {
        dppHargaJual,
        dppNilaiLain,
        ppn,
        effectiveMode,
        effectiveTrxCode,
        sign,
    };
}

export function sanitizeDigits(val?: string | null): string {
    return (val || "").replace(/\D/g, "");
}

export function escapeXml(str: string | number | null | undefined): string {
    if (str === null || str === undefined) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function formatDateDdMmYyyy(dateStr?: string | null): string {
    if (!dateStr) return "";
    const iso = dateStr.slice(0, 10);
    const parts = iso.split("-");
    if (parts.length !== 3) return iso;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export interface CoretaxKeluaranInvoice {
    invoice: string;
    date: string;
    taxInvoiceDate?: string | null;
    trxCode: string;
    refDesc?: string | null;
    buyerName: string;
    buyerNpwp?: string | null;
    buyerNitku?: string | null;
    buyerAddress?: string | null;
    buyerEmail?: string | null;
    items: Array<{
        name: string;
        unit?: string | null;
        price: number;
        qty: number;
        discount: number;
        dppHargaJual: number;
        dppNilaiLain: number;
        ppn: number;
        taxRate: number;
    }>;
}

export function buildCoretaxFakturKeluaranXml(params: {
    sellerTin: string;
    sellerNitku?: string | null;
    useDppNilaiLain: boolean;
    invoices: CoretaxKeluaranInvoice[];
}): string {
    const sellerTin = sanitizeDigits(params.sellerTin) || "0000000000000000";
    const sellerIdTku =
        sanitizeDigits(params.sellerNitku) || `${sellerTin}000000`;

    const invoiceBlocks = params.invoices
        .map((inv) => {
            const rawBuyerId = sanitizeDigits(inv.buyerNpwp);
            const buyerTin = rawBuyerId.length === 16 ? rawBuyerId : "0000000000000000";
            const buyerDoc = rawBuyerId.length > 0 && rawBuyerId.length !== 16 ? "NIK" : "TIN";
            const buyerDocNum = buyerDoc === "NIK" ? rawBuyerId : "-";
            const buyerIdTku =
                sanitizeDigits(inv.buyerNitku) ||
                (buyerTin !== "0000000000000000"
                    ? `${buyerTin}000000`
                    : "0000000000000000000000");

            const itemXml = inv.items
                .map((item) => {
                    const taxBase = Math.round(item.dppHargaJual);
                    const otherTaxBase = Math.round(item.dppNilaiLain);
                    const vat = Math.round(item.ppn);
                    const vatRate = params.useDppNilaiLain && item.taxRate > 0 ? 12 : item.taxRate;

                    return `      <GoodService>
        <Opt>A</Opt>
        <Code>000000</Code>
        <Name>${escapeXml(item.name)}</Name>
        <Unit>${escapeXml(item.unit || "UM.0018")}</Unit>
        <Price>${Math.round(item.price)}</Price>
        <Qty>${item.qty}</Qty>
        <TotalDiscount>${Math.round(item.discount)}</TotalDiscount>
        <TaxBase>${taxBase}</TaxBase>
        <OtherTaxBase>${otherTaxBase}</OtherTaxBase>
        <VATRate>${vatRate}</VATRate>
        <VAT>${vat}</VAT>
        <STLGRate>0</STLGRate>
        <STLG>0</STLG>
      </GoodService>`;
                })
                .join("\n");

            const invoiceDate = (inv.taxInvoiceDate || inv.date).slice(0, 10);

            return `    <TaxInvoice>
      <TaxInvoiceDate>${escapeXml(invoiceDate)}</TaxInvoiceDate>
      <TaxInvoiceOpt>Normal</TaxInvoiceOpt>
      <TrxCode>${escapeXml(inv.trxCode || (params.useDppNilaiLain ? "04" : "01"))}</TrxCode>
      <AddInfo />
      <CustomDoc />
      <RefDesc>${escapeXml(inv.refDesc || inv.invoice)}</RefDesc>
      <FacilityStamp />
      <SellerIDTKU>${escapeXml(sellerIdTku)}</SellerIDTKU>
      <BuyerTin>${escapeXml(buyerTin)}</BuyerTin>
      <BuyerDocument>${escapeXml(buyerDoc)}</BuyerDocument>
      <BuyerCountry>IDN</BuyerCountry>
      <BuyerDocumentNumber>${escapeXml(buyerDocNum)}</BuyerDocumentNumber>
      <BuyerName>${escapeXml(inv.buyerName)}</BuyerName>
      <BuyerAdress>${escapeXml(inv.buyerAddress || "-")}</BuyerAdress>
      <BuyerEmail>${escapeXml(inv.buyerEmail || "-")}</BuyerEmail>
      <BuyerIDTKU>${escapeXml(buyerIdTku)}</BuyerIDTKU>
      <ListOfGoodService>
${itemXml}
      </ListOfGoodService>
    </TaxInvoice>`;
        })
        .join("\n");

    return `<?xml version="1.0" encoding="utf-8"?>
<TaxInvoiceBulk xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="TaxInvoice.xsd">
  <TIN>${escapeXml(sellerTin)}</TIN>
  <ListOfTaxInvoice>
${invoiceBlocks}
  </ListOfTaxInvoice>
</TaxInvoiceBulk>
`;
}

export interface CoretaxDigunggungEntry {
    invoice: string;
    date: string;
    trxCode: string;
    buyerName?: string | null;
    buyerNpwp?: string | null;
    dppHargaJual: number;
    dppNilaiLain: number;
    ppn: number;
}

export function buildCoretaxDigunggungXml(params: {
    sellerTin: string;
    taxPeriodMonth: number;
    taxPeriodYear: number;
    entries: CoretaxDigunggungEntry[];
}): string {
    const sellerTin = sanitizeDigits(params.sellerTin) || "0000000000000000";

    const rowsXml = params.entries
        .map((entry) => {
            const buyerDigits = sanitizeDigits(entry.buyerNpwp);
            const buyerIdNumber =
                buyerDigits.length === 16 ? buyerDigits : "0000000000000000";

            return `    <ReturOrDigunggung>
      <TrxCode>${escapeXml(entry.trxCode || "Normal")}</TrxCode>
      <BuyerName>${escapeXml(entry.buyerName || "-")}</BuyerName>
      <BuyerIdOpt>NIK</BuyerIdOpt>
      <BuyerIdNumber>${escapeXml(buyerIdNumber)}</BuyerIdNumber>
      <GoodServiceOpt>A</GoodServiceOpt>
      <SerialNo>${escapeXml(entry.invoice)}</SerialNo>
      <TransactionDate>${escapeXml(formatDateDdMmYyyy(entry.date))}</TransactionDate>
      <TaxBaseSellingPrice>${Math.round(entry.dppHargaJual)}</TaxBaseSellingPrice>
      <OtherTaxBaseSellingPrice>${Math.round(entry.dppNilaiLain)}</OtherTaxBaseSellingPrice>
      <VAT>${Math.round(entry.ppn)}</VAT>
      <STLG>0</STLG>
    </ReturOrDigunggung>`;
        })
        .join("\n");

    return `<?xml version="1.0" encoding="utf-8"?>
<VATReturnDigunggungBulk>
  <TIN>${escapeXml(sellerTin)}</TIN>
  <TaxPeriodMonth>${params.taxPeriodMonth}</TaxPeriodMonth>
  <TaxPeriodYear>${params.taxPeriodYear}</TaxPeriodYear>
  <ListOfDigunggung1A5>
${rowsXml}
  </ListOfDigunggung1A5>
</VATReturnDigunggungBulk>
`;
}

