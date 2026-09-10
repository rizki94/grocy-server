ALTER TABLE "marketplaces" ADD COLUMN IF NOT EXISTS "contact_id" uuid REFERENCES "contacts"("id");
