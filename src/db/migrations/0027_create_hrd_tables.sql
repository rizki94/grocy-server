-- Migration 0027: Create HRD tables (work_shifts, employees, attendances, payrolls)

CREATE TABLE IF NOT EXISTS "work_shifts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" text NOT NULL,
    "start_time" text NOT NULL,
    "end_time" text NOT NULL,
    "grace_period_minutes" integer NOT NULL DEFAULT 15,
    "is_active" boolean NOT NULL DEFAULT true,
    "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "employees" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "nik" text NOT NULL UNIQUE,
    "full_name" text NOT NULL,
    "phone" text,
    "email" text,
    "id_card_number" text,
    "department" text NOT NULL,
    "position" text NOT NULL,
    "branch_id" uuid NOT NULL REFERENCES "branches"("id"),
    "user_id" uuid REFERENCES "users"("id"),
    "default_shift_id" uuid REFERENCES "work_shifts"("id"),
    "employment_status" text NOT NULL DEFAULT 'permanent',
    "join_date" date NOT NULL,
    "end_date" date,
    "base_salary" numeric(12, 2) NOT NULL DEFAULT 0,
    "daily_allowance" numeric(10, 2) NOT NULL DEFAULT 0,
    "bank_name" text,
    "bank_account_no" text,
    "bank_account_holder" text,
    "mobile_pin" text,
    "is_active" boolean NOT NULL DEFAULT true,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "attendances" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
    "shift_id" uuid REFERENCES "work_shifts"("id"),
    "date" date NOT NULL,
    "clock_in" timestamp,
    "clock_out" timestamp,
    "clock_in_photo" text,
    "clock_in_location" text,
    "clock_out_photo" text,
    "clock_out_location" text,
    "status" text NOT NULL DEFAULT 'present',
    "late_minutes" integer NOT NULL DEFAULT 0,
    "overtime_hours" numeric(5, 2) NOT NULL DEFAULT 0,
    "notes" text,
    "created_at" timestamp NOT NULL DEFAULT now(),
    CONSTRAINT "attendances_employee_date_unique" UNIQUE ("employee_id", "date")
);

CREATE TABLE IF NOT EXISTS "payrolls" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "invoice" text NOT NULL UNIQUE,
    "period" text NOT NULL,
    "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
    "start_date" date NOT NULL,
    "end_date" date NOT NULL,
    "present_days" integer NOT NULL DEFAULT 0,
    "late_minutes" integer NOT NULL DEFAULT 0,
    "overtime_hours" numeric(5, 2) NOT NULL DEFAULT 0,
    "base_salary" numeric(12, 2) NOT NULL DEFAULT 0,
    "total_allowance" numeric(12, 2) NOT NULL DEFAULT 0,
    "total_overtime_pay" numeric(12, 2) NOT NULL DEFAULT 0,
    "total_incentive" numeric(12, 2) NOT NULL DEFAULT 0,
    "total_deduction" numeric(12, 2) NOT NULL DEFAULT 0,
    "net_salary" numeric(12, 2) NOT NULL DEFAULT 0,
    "status" text NOT NULL DEFAULT 'draft',
    "paid_at" timestamp,
    "notes" text,
    "created_at" timestamp NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS "idx_employees_branch" ON "employees"("branch_id");
CREATE INDEX IF NOT EXISTS "idx_employees_nik" ON "employees"("nik");
CREATE INDEX IF NOT EXISTS "idx_attendances_date" ON "attendances"("date");
CREATE INDEX IF NOT EXISTS "idx_attendances_emp_date" ON "attendances"("employee_id", "date");
CREATE INDEX IF NOT EXISTS "idx_payrolls_period" ON "payrolls"("period");

