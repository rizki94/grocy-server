ALTER TABLE "marketplaces" ADD COLUMN IF NOT EXISTS "category_attribute_id" uuid REFERENCES "product_attributes"("id");

