ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "cogs_gl_account_id" uuid REFERENCES "gl_accounts"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "inventory_gl_account_id" uuid REFERENCES "gl_accounts"("id") ON DELETE SET NULL;
