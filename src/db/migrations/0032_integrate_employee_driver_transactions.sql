-- Migration 0032: Integrate Employee, Driver, and Transaction PIC
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "position_type" text NOT NULL DEFAULT 'other';
ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "employee_id" uuid REFERENCES "employees"("id");
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "salesperson_id" uuid REFERENCES "employees"("id");
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "purchasing_pic_id" uuid REFERENCES "employees"("id");
