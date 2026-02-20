ALTER TABLE "accounts" ADD COLUMN "plan" text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "max_branches" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "max_users" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "credit_limit" numeric(15, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "invoice_limit" smallint DEFAULT 0;--> statement-breakpoint
ALTER TABLE "delivery_dispatch_trucks" ADD COLUMN "driver_id" uuid;--> statement-breakpoint
ALTER TABLE "delivery_dispatch_trucks" ADD COLUMN "delivery_route_id" uuid;--> statement-breakpoint
ALTER TABLE "delivery_dispatch_trucks" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "delivery_dispatch_trucks" ADD CONSTRAINT "delivery_dispatch_trucks_driver_id_delivery_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."delivery_drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_dispatch_trucks" ADD CONSTRAINT "delivery_dispatch_trucks_delivery_route_id_delivery_routes_id_fk" FOREIGN KEY ("delivery_route_id") REFERENCES "public"."delivery_routes"("id") ON DELETE no action ON UPDATE no action;