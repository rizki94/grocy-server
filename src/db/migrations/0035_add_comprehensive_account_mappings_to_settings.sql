ALTER TABLE "settings"
ADD COLUMN IF NOT EXISTS "ar_gl_account_id" uuid REFERENCES "gl_accounts"("id") ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS "sales_revenue_gl_account_id" uuid REFERENCES "gl_accounts"("id") ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS "sales_tax_gl_account_id" uuid REFERENCES "gl_accounts"("id") ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS "ap_gl_account_id" uuid REFERENCES "gl_accounts"("id") ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS "purchase_tax_gl_account_id" uuid REFERENCES "gl_accounts"("id") ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS "sales_return_gl_account_id" uuid REFERENCES "gl_accounts"("id") ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS "purchase_return_gl_account_id" uuid REFERENCES "gl_accounts"("id") ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS "stock_loss_gl_account_id" uuid REFERENCES "gl_accounts"("id") ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS "stock_gain_gl_account_id" uuid REFERENCES "gl_accounts"("id") ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS "payment_admin_fee_gl_account_id" uuid REFERENCES "gl_accounts"("id") ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS "payment_discount_gl_account_id" uuid REFERENCES "gl_accounts"("id") ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS "payroll_expense_gl_account_id" uuid REFERENCES "gl_accounts"("id") ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS "payroll_payable_gl_account_id" uuid REFERENCES "gl_accounts"("id") ON DELETE SET NULL;
