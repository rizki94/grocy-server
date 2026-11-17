-- Migration 0030: Add require_product_formula_name to settings
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "require_product_formula_name" boolean DEFAULT false NOT NULL;
