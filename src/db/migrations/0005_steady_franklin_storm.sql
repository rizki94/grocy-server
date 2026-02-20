ALTER TYPE "public"."transaction_status" ADD VALUE 'partial' BEFORE 'paid';--> statement-breakpoint
ALTER TABLE "accounts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "branches" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "delivery_routes" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "delivery_dispatch_items" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "delivery_dispatch_trucks" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "delivery_dispatches" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "delivery_drivers" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "delivery_trucks" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_promotion_rules" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_promotions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "warehouses" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_branches" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "accounts" CASCADE;--> statement-breakpoint
DROP TABLE "branches" CASCADE;--> statement-breakpoint
DROP TABLE "delivery_routes" CASCADE;--> statement-breakpoint
DROP TABLE "delivery_dispatch_items" CASCADE;--> statement-breakpoint
DROP TABLE "delivery_dispatch_trucks" CASCADE;--> statement-breakpoint
DROP TABLE "delivery_dispatches" CASCADE;--> statement-breakpoint
DROP TABLE "delivery_drivers" CASCADE;--> statement-breakpoint
DROP TABLE "delivery_trucks" CASCADE;--> statement-breakpoint
DROP TABLE "product_promotion_rules" CASCADE;--> statement-breakpoint
DROP TABLE "product_promotions" CASCADE;--> statement-breakpoint
DROP TABLE "warehouses" CASCADE;--> statement-breakpoint
DROP TABLE "product_branches" CASCADE;--> statement-breakpoint
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "gl_accounts" DROP CONSTRAINT "gl_accounts_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "gl_accounts" DROP CONSTRAINT "gl_accounts_branch_id_branches_id_fk";
--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "roles" DROP CONSTRAINT "roles_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_branch_id_branches_id_fk";
--> statement-breakpoint
ALTER TABLE "taxes" DROP CONSTRAINT "taxes_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "product_units" DROP CONSTRAINT "product_units_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "product_attributes" DROP CONSTRAINT "product_attributes_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "journals" DROP CONSTRAINT "journals_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_branch_id_branches_id_fk";
--> statement-breakpoint
ALTER TABLE "contacts" DROP COLUMN "account_id";--> statement-breakpoint
ALTER TABLE "gl_accounts" DROP COLUMN "account_id";--> statement-breakpoint
ALTER TABLE "gl_accounts" DROP COLUMN "branch_id";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "account_id";--> statement-breakpoint
ALTER TABLE "roles" DROP COLUMN "account_id";--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "account_id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "account_id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "branch_id";--> statement-breakpoint
ALTER TABLE "taxes" DROP COLUMN "account_id";--> statement-breakpoint
ALTER TABLE "product_units" DROP COLUMN "account_id";--> statement-breakpoint
ALTER TABLE "product_attributes" DROP COLUMN "account_id";--> statement-breakpoint
ALTER TABLE "journals" DROP COLUMN "account_id";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "account_id";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "branch_id";--> statement-breakpoint
DROP TYPE "public"."promotion_type";