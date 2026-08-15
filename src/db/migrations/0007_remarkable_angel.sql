ALTER TABLE "contacts" ADD COLUMN "latitude" numeric(10, 8);--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "longitude" numeric(11, 8);--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "route_group" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "salesperson_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "enable_inventory_tracking" boolean DEFAULT true NOT NULL;