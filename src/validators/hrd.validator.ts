import z from "zod";

// ── Work Shift Validators ──────────────────────────────────────────────────
export const workShiftInsertSchema = z.object({
    name: z.string().min(1, "Shift name is required"),
    startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Start time must be HH:mm"),
    endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "End time must be HH:mm"),
    gracePeriodMinutes: z.coerce.number().min(0).default(15),
    isActive: z.boolean().default(true),
});

export const workShiftUpdateSchema = workShiftInsertSchema.extend({
    id: z.string().uuid("Invalid ID"),
});

// ── Employee Validators ────────────────────────────────────────────────────
export const employeeInsertSchema = z.object({
    nik: z.string().min(1, "NIK is required"),
    fullName: z.string().min(1, "Full name is required"),
    phone: z.string().optional().nullable(),
    email: z.string().email().optional().nullable().or(z.literal("")),
    idCardNumber: z.string().optional().nullable(),
    department: z.string().min(1, "Department is required"),
    position: z.string().min(1, "Position is required"),
    branchId: z.string().uuid("Branch is required"),
    userId: z.string().uuid().optional().nullable().or(z.literal("")),
    defaultShiftId: z.string().uuid().optional().nullable().or(z.literal("")),
    employmentStatus: z.enum(["permanent", "contract", "probation", "intern", "part_time"]).default("permanent"),
    joinDate: z.string().min(1, "Join date is required"),
    endDate: z.string().optional().nullable().or(z.literal("")),
    baseSalary: z.coerce.number().min(0).default(0),
    dailyAllowance: z.coerce.number().min(0).default(0),
    bankName: z.string().optional().nullable(),
    bankAccountNo: z.string().optional().nullable(),
    bankAccountHolder: z.string().optional().nullable(),
    mobilePin: z.string().optional().nullable().or(z.literal("")),
    isActive: z.boolean().default(true),
});

export const employeeUpdateSchema = employeeInsertSchema.extend({
    id: z.string().uuid("Invalid ID"),
});

// ── Attendance Validators ──────────────────────────────────────────────────
export const attendanceClockInSchema = z.object({
    employeeId: z.string().uuid("Employee ID is required"),
    shiftId: z.string().uuid().optional().nullable(),
    date: z.string().optional(), // YYYY-MM-DD, defaults to today
    time: z.string().optional(), // ISO string or HH:mm, defaults to now
    clockInLocation: z.string().optional().nullable(), // Lat,Lng
    clockInPhoto: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
});

export const attendanceClockOutSchema = z.object({
    employeeId: z.string().uuid("Employee ID is required"),
    time: z.string().optional(), // ISO string or HH:mm, defaults to now
    clockOutLocation: z.string().optional().nullable(),
    clockOutPhoto: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
});

export const attendanceManualSchema = z.object({
    id: z.string().uuid().optional(),
    employeeId: z.string().uuid("Employee ID is required"),
    shiftId: z.string().uuid().optional().nullable(),
    date: z.string().min(1, "Date is required"),
    clockIn: z.string().optional().nullable(),
    clockOut: z.string().optional().nullable(),
    status: z.enum(["present", "late", "early_leave", "sick", "leave", "alpha", "holiday"]).default("present"),
    lateMinutes: z.coerce.number().min(0).default(0),
    overtimeHours: z.coerce.number().min(0).default(0),
    notes: z.string().optional().nullable(),
});

// ── Payroll Validators ─────────────────────────────────────────────────────
export const generatePayrollSchema = z.object({
    period: z.string().regex(/^\d{4}-\d{2}$/, "Period must be YYYY-MM"),
    startDate: z.string().min(1, "Start date is required"),
    endDate: z.string().min(1, "End date is required"),
    branchId: z.string().uuid().optional().nullable(),
    employeeId: z.string().uuid().optional().nullable(),
    lateDeductionPerMinute: z.coerce.number().min(0).default(0),
    overtimeHourlyRate: z.coerce.number().min(0).optional().nullable(), // If not specified, calculated from baseSalary / 173
});

export const payrollUpdateSchema = z.object({
    id: z.string().uuid("Invalid Payroll ID"),
    status: z.enum(["draft", "approved", "paid"]).optional(),
    totalIncentive: z.coerce.number().min(0).optional(),
    totalDeduction: z.coerce.number().min(0).optional(),
    paidAt: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
});

export type WorkShiftInsertInput = z.infer<typeof workShiftInsertSchema>;
export type EmployeeInsertInput = z.infer<typeof employeeInsertSchema>;
export type EmployeeUpdateInput = z.infer<typeof employeeUpdateSchema>;
export type AttendanceClockInInput = z.infer<typeof attendanceClockInSchema>;
export type AttendanceClockOutInput = z.infer<typeof attendanceClockOutSchema>;
export type AttendanceManualInput = z.infer<typeof attendanceManualSchema>;
export type GeneratePayrollInput = z.infer<typeof generatePayrollSchema>;
export type PayrollUpdateInput = z.infer<typeof payrollUpdateSchema>;

