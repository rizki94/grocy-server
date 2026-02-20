-- Migration: Simplify transaction schema
-- Remove branch, warehouse, and price group dependencies

-- Drop constraints if they exist
DO $$ 
BEGIN
    -- Drop contacts constraints
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_branch_id_branches_id_fk') THEN
        ALTER TABLE "contacts" DROP CONSTRAINT "contacts_branch_id_branches_id_fk";
    END IF;
    
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_price_group_id_price_groups_id_fk') THEN
        ALTER TABLE "contacts" DROP CONSTRAINT "contacts_price_group_id_price_groups_id_fk";
    END IF;
    
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_delivery_route_id_delivery_routes_id_fk') THEN
        ALTER TABLE "contacts" DROP CONSTRAINT "contacts_delivery_route_id_delivery_routes_id_fk";
    END IF;
    
    -- Drop transaction_details constraints
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transaction_details_warehouse_id_warehouses_id_fk') THEN
        ALTER TABLE "transaction_details" DROP CONSTRAINT "transaction_details_warehouse_id_warehouses_id_fk";
    END IF;
    
    -- Drop transactions constraints
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_branch_id_branches_id_fk') THEN
        ALTER TABLE "transactions" DROP CONSTRAINT "transactions_branch_id_branches_id_fk";
    END IF;
    
    -- Drop stocks constraints
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stocks_warehouse_id_warehouses_id_fk') THEN
        ALTER TABLE "stocks" DROP CONSTRAINT "stocks_warehouse_id_warehouses_id_fk";
    END IF;
    
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stocks_product_id_warehouse_id_unique') THEN
        ALTER TABLE "stocks" DROP CONSTRAINT "stocks_product_id_warehouse_id_unique";
    END IF;
    
    -- Drop journals constraints
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'journals_branch_id_branches_id_fk') THEN
        ALTER TABLE "journals" DROP CONSTRAINT "journals_branch_id_branches_id_fk";
    END IF;
END $$;

-- Add price column to product_details if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'product_details' AND column_name = 'price') THEN
        ALTER TABLE "product_details" ADD COLUMN "price" numeric(10,2) DEFAULT 0 NOT NULL;
    END IF;
END $$;

-- Drop columns if they exist
DO $$ 
BEGIN
    -- Drop contacts columns
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'contacts' AND column_name = 'branch_id') THEN
        ALTER TABLE "contacts" DROP COLUMN "branch_id";
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'contacts' AND column_name = 'price_group_id') THEN
        ALTER TABLE "contacts" DROP COLUMN "price_group_id";
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'contacts' AND column_name = 'delivery_route_id') THEN
        ALTER TABLE "contacts" DROP COLUMN "delivery_route_id";
    END IF;
    
    -- Drop transaction_details columns
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'transaction_details' AND column_name = 'warehouse_id') THEN
        ALTER TABLE "transaction_details" DROP COLUMN "warehouse_id";
    END IF;
    
    -- Drop transactions columns
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'branch_id') THEN
        ALTER TABLE "transactions" DROP COLUMN "branch_id";
    END IF;
    
    -- Drop stocks columns
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'stocks' AND column_name = 'warehouse_id') THEN
        ALTER TABLE "stocks" DROP COLUMN "warehouse_id";
    END IF;
    
    -- Drop journals columns
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'journals' AND column_name = 'branch_id') THEN
        ALTER TABLE "journals" DROP COLUMN "branch_id";
    END IF;
END $$;

-- Add unique constraint on stocks.product_id if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stocks_product_id_unique') THEN
        ALTER TABLE "stocks" ADD CONSTRAINT "stocks_product_id_unique" UNIQUE("product_id");
    END IF;
END $$;

-- Drop price group tables if they exist
DROP TABLE IF EXISTS "product_detail_prices" CASCADE;
DROP TABLE IF EXISTS "price_groups" CASCADE;
