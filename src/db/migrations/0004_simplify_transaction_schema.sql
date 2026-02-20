ALTER TABLE "price_groups" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_detail_prices" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "price_groups" CASCADE;--> statement-breakpoint
DROP TABLE "product_detail_prices" CASCADE;--> statement-breakpoint
ALTER TABLE "stocks" DROP CONSTRAINT "stocks_product_id_warehouse_id_unique";--> statement-breakpoint
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_branch_id_branches_id_fk";
--> statement-breakpoint
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_price_group_id_price_groups_id_fk";
--> statement-breakpoint
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_delivery_route_id_delivery_routes_id_fk";
--> statement-breakpoint
ALTER TABLE "transaction_details" DROP CONSTRAINT "transaction_details_warehouse_id_warehouses_id_fk";
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_branch_id_branches_id_fk";
--> statement-breakpoint
ALTER TABLE "stocks" DROP CONSTRAINT "stocks_warehouse_id_warehouses_id_fk";
--> statement-breakpoint
ALTER TABLE "journals" DROP CONSTRAINT "journals_branch_id_branches_id_fk";
--> statement-breakpoint
ALTER TABLE "product_details" ADD COLUMN "price" numeric(10,2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" DROP COLUMN "branch_id";--> statement-breakpoint
ALTER TABLE "contacts" DROP COLUMN "price_group_id";--> statement-breakpoint
ALTER TABLE "contacts" DROP COLUMN "delivery_route_id";--> statement-breakpoint
ALTER TABLE "transaction_details" DROP COLUMN "warehouse_id";--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "branch_id";--> statement-breakpoint
ALTER TABLE "stocks" DROP COLUMN "warehouse_id";--> statement-breakpoint
ALTER TABLE "journals" DROP COLUMN "branch_id";--> statement-breakpoint
ALTER TABLE "stocks" ADD CONSTRAINT "stocks_product_id_unique" UNIQUE("product_id");