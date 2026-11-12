-- Add Indonesian Coretax PKP identity & tax reporting fields
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS npwp TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS nitku TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_pkp BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS tax_address TEXT;

ALTER TABLE settings ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS company_npwp TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS company_nitku TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS company_tax_address TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS use_dpp_nilai_lain BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS tax_reporting_mode TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS tax_invoice_code TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS tax_invoice_number TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS tax_invoice_date DATE;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS tax_invoice_status TEXT DEFAULT 'pending';

