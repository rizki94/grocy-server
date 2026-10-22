-- Add print_layouts JSONB column to settings table
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "print_layouts" jsonb;
