-- Migration 0031: Add product_naming_formula to settings
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "product_naming_formula" text DEFAULT '' NOT NULL;
