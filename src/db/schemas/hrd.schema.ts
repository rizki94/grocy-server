import { decimalAsNumber } from "@/types/decimal-as-number";
import {
    boolean,
    date,
    integer,
    pgTable,
    text,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { branches } from "./branch.schema";
import { users } from "./user.schema";

// ── Work Shifts (Shift Kerja) ──────────────────────────────────────────────────
export const workShifts = pgTable("work_shifts", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    startTime: text("start_time").notNull(), // e.g. "08:00"
    endTime: text("end_time").notNull(),     // e.g. "17:00"
    gracePeriodMinutes: integer("grace_period_minutes").notNull().default(15), // late tolerance
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const workShiftsRelations = relations(workShifts, ({ many }) => ({
    employees: many(employees),
    attendances: many(attendances),
}));

// ── Employees (Master Karyawan) ────────────────────────────────────────────────
export const employees = pgTable("employees", {
    id: uuid("id").defaultRandom().primaryKey(),
    nik: text("nik").notNull().unique(), // Employee Code / NIK
    fullName: text("full_name").notNull(),
    phone: text("phone"),
    email: text("email"),
    idCardNumber: text("id_card_number"), // No KTP
    department: text("department").notNull(), // Kasir, Gudang, Logistik, Penjualan, Manajemen
    position: text("position").notNull(),     // Kepala Toko, Kasir Senior, Helper, Supir
    branchId: uuid("branch_id")
        .notNull()
        .references(() => branches.id),
    userId: uuid("user_id").references(() => users.id), // Optional 1-to-1 account link
    defaultShiftId: uuid("default_shift_id").references(() => workShifts.id),
    employmentStatus: text("employment_status").notNull().default("permanent"), // permanent, contract, probation, intern, part_time
    joinDate: date("join_date").notNull(),
    endDate: date("end_date"),
    baseSalary: decimalAsNumber(12, 2)("base_salary").notNull().default(0),
    dailyAllowance: decimalAsNumber(10, 2)("daily_allowance").notNull().default(0), // Uang makan/transport harian
    bankName: text("bank_name"),
    bankAccountNo: text("bank_account_no"),
    bankAccountHolder: text("bank_account_holder"),
    mobilePin: text("mobile_pin"), // PIN for mobile attendance
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const employeesRelations = relations(employees, ({ one, many }) => ({
    branch: one(branches, {
        fields: [employees.branchId],
        references: [branches.id],
    }),
    user: one(users, {
        fields: [employees.userId],
        references: [users.id],
    }),
    defaultShift: one(workShifts, {
        fields: [employees.defaultShiftId],
        references: [workShifts.id],
    }),
    attendances: many(attendances),
    payrolls: many(payrolls),
}));

// ── Attendances (Absensi & Keterlambatan) ───────────────────────────────────────
export const attendances = pgTable("attendances", {
    id: uuid("id").defaultRandom().primaryKey(),
    employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id, { onDelete: "cascade" }),
    shiftId: uuid("shift_id").references(() => workShifts.id),
    date: date("date").notNull(), // YYYY-MM-DD
    clockIn: timestamp("clock_in"),
    clockOut: timestamp("clock_out"),
    clockInPhoto: text("clock_in_photo"),       // URL selfie
    clockInLocation: text("clock_in_location"), // Lat,Lng
    clockOutPhoto: text("clock_out_photo"),
    clockOutLocation: text("clock_out_location"),
    status: text("status").notNull().default("present"), // present, late, early_leave, sick, leave, alpha, holiday
    lateMinutes: integer("late_minutes").notNull().default(0),
    overtimeHours: decimalAsNumber(5, 2)("overtime_hours").notNull().default(0),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const attendancesRelations = relations(attendances, ({ one }) => ({
    employee: one(employees, {
        fields: [attendances.employeeId],
        references: [employees.id],
    }),
    shift: one(workShifts, {
        fields: [attendances.shiftId],
        references: [workShifts.id],
    }),
}));

// ── Payrolls (Penggajian & Slip Gaji) ──────────────────────────────────────────
export const payrolls = pgTable("payrolls", {
    id: uuid("id").defaultRandom().primaryKey(),
    invoice: text("invoice").notNull().unique(), // e.g. "PAY-2611-0001"
    period: text("period").notNull(),            // e.g. "2026-11"
    employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id, { onDelete: "cascade" }),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    presentDays: integer("present_days").notNull().default(0),
    lateMinutes: integer("late_minutes").notNull().default(0),
    overtimeHours: decimalAsNumber(5, 2)("overtime_hours").notNull().default(0),
    baseSalary: decimalAsNumber(12, 2)("base_salary").notNull().default(0),
    totalAllowance: decimalAsNumber(12, 2)("total_allowance").notNull().default(0),
    totalOvertimePay: decimalAsNumber(12, 2)("total_overtime_pay").notNull().default(0),
    totalIncentive: decimalAsNumber(12, 2)("total_incentive").notNull().default(0),
    totalDeduction: decimalAsNumber(12, 2)("total_deduction").notNull().default(0),
    netSalary: decimalAsNumber(12, 2)("net_salary").notNull().default(0),
    status: text("status").notNull().default("draft"), // draft, approved, paid
    paidAt: timestamp("paid_at"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const payrollsRelations = relations(payrolls, ({ one }) => ({
    employee: one(employees, {
        fields: [payrolls.employeeId],
        references: [employees.id],
    }),
}));

