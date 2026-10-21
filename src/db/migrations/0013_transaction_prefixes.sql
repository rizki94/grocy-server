-- Extend settings table with transaction prefixes
ALTER TABLE "settings"
    ADD COLUMN IF NOT EXISTS "purchase_prefix" text NOT NULL DEFAULT 'PUR',
    ADD COLUMN IF NOT EXISTS "sales_prefix" text NOT NULL DEFAULT 'SLS',
    ADD COLUMN IF NOT EXISTS "sales_return_prefix" text NOT NULL DEFAULT 'SLR',
    ADD COLUMN IF NOT EXISTS "purchase_return_prefix" text NOT NULL DEFAULT 'PCR',
    ADD COLUMN IF NOT EXISTS "transfer_stock_prefix" text NOT NULL DEFAULT 'TRF',
    ADD COLUMN IF NOT EXISTS "adjustment_prefix" text NOT NULL DEFAULT 'ADJ',
    ADD COLUMN IF NOT EXISTS "pos_sales_prefix" text NOT NULL DEFAULT 'POS';
