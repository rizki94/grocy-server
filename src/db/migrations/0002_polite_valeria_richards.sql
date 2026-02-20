CREATE TABLE "delivery_dispatch_trucks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispatch_id" uuid NOT NULL,
	"truck_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "delivery_dispatch_items" RENAME COLUMN "dispatch_id" TO "dispatch_truck_id";--> statement-breakpoint
ALTER TABLE "delivery_dispatch_items" DROP CONSTRAINT "delivery_dispatch_items_dispatch_id_delivery_dispatches_id_fk";
--> statement-breakpoint
ALTER TABLE "delivery_dispatches" DROP CONSTRAINT "delivery_dispatches_truck_id_delivery_trucks_id_fk";
--> statement-breakpoint
ALTER TABLE "delivery_dispatches" DROP CONSTRAINT "delivery_dispatches_driver_id_delivery_drivers_id_fk";
--> statement-breakpoint
ALTER TABLE "delivery_trucks" ADD COLUMN "driver_id" uuid;--> statement-breakpoint
ALTER TABLE "delivery_trucks" ADD COLUMN "max_weight" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "delivery_trucks" ADD COLUMN "max_volume" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "delivery_dispatch_trucks" ADD CONSTRAINT "delivery_dispatch_trucks_dispatch_id_delivery_dispatches_id_fk" FOREIGN KEY ("dispatch_id") REFERENCES "public"."delivery_dispatches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_dispatch_trucks" ADD CONSTRAINT "delivery_dispatch_trucks_truck_id_delivery_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."delivery_trucks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_dispatch_items" ADD CONSTRAINT "delivery_dispatch_items_dispatch_truck_id_delivery_dispatch_trucks_id_fk" FOREIGN KEY ("dispatch_truck_id") REFERENCES "public"."delivery_dispatch_trucks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_trucks" ADD CONSTRAINT "delivery_trucks_driver_id_delivery_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."delivery_drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_parent_id_transactions_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_dispatches" DROP COLUMN "truck_id";--> statement-breakpoint
ALTER TABLE "delivery_dispatches" DROP COLUMN "driver_id";