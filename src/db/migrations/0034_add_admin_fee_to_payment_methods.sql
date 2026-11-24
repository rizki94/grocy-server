ALTER TABLE "payment_methods" ADD COLUMN IF NOT EXISTS "fee_percentage" numeric(5, 2) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "payment_methods" ADD COLUMN IF NOT EXISTS "fee_gl_account_id" uuid REFERENCES "gl_accounts"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "fee_amount" numeric(12, 2) NOT NULL DEFAULT 0;
