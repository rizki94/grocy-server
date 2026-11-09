import { db } from "@/db";
import {
    attendances,
    branches,
    employees,
    payrolls,
    users,
    workShifts,
} from "@/db/schemas";
import { logAction } from "@/utils/log-helper";
import {
    attendanceClockInSchema,
    attendanceClockOutSchema,
    attendanceManualSchema,
    employeeInsertSchema,
    employeeUpdateSchema,
    generatePayrollSchema,
    payrollUpdateSchema,
    workShiftInsertSchema,
    workShiftUpdateSchema,
} from "@/validators/hrd.validator";
import { and, desc, eq, gte, like, lte, or, sql } from "drizzle-orm";
import { Request, Response } from "express";

// ─────────────────────────────────────────────────────────────────────────────
// WORK SHIFTS
// ─────────────────────────────────────────────────────────────────────────────

export const getWorkShifts = async (req: Request, res: Response) => {
    try {
        const shifts = await db
            .select()
            .from(workShifts)
            .orderBy(workShifts.startTime);
        res.status(200).json(shifts);
    } catch (error) {
        console.error("Error fetching work shifts:", error);
        res.status(500).json({ message: "Failed to fetch work shifts" });
    }
};

export const createWorkShift = async (req: Request, res: Response) => {
    const parsed = workShiftInsertSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    try {
        const [shift] = await db
            .insert(workShifts)
            .values(parsed.data)
            .returning();

        return res.status(201).json({
            message: "Work shift created successfully",
            shift,
        });
    } catch (error) {
        console.error("Error creating work shift:", error);
        return res.status(500).json({ message: "Failed to create work shift" });
    }
};

export const updateWorkShift = async (req: Request, res: Response) => {
    const parsed = workShiftUpdateSchema.safeParse({
        ...req.body,
        id: req.params.id || req.body.id,
    });
    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    try {
        const [shift] = await db
            .update(workShifts)
            .set({
                name: parsed.data.name,
                startTime: parsed.data.startTime,
                endTime: parsed.data.endTime,
                gracePeriodMinutes: parsed.data.gracePeriodMinutes,
                isActive: parsed.data.isActive,
            })
            .where(eq(workShifts.id, parsed.data.id))
            .returning();

        if (!shift) {
            return res.status(404).json({ message: "Work shift not found" });
        }

        return res.status(200).json({
            message: "Work shift updated successfully",
            shift,
        });
    } catch (error) {
        console.error("Error updating work shift:", error);
        return res.status(500).json({ message: "Failed to update work shift" });
    }
};

export const deleteWorkShift = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        await db.delete(workShifts).where(eq(workShifts.id, id));
        return res.status(200).json({ message: "Work shift deleted successfully" });
    } catch (error) {
        console.error("Error deleting work shift:", error);
        return res.status(500).json({ message: "Failed to delete work shift" });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// EMPLOYEES
// ─────────────────────────────────────────────────────────────────────────────

export const getEmployees = async (req: Request, res: Response) => {
    try {
        const query = req.query;
        const pageIndex = parseInt(query.pageIndex as string) || 0;
        const pageSize = parseInt(query.pageSize as string) || 10;
        const offset = pageIndex * pageSize;

        const search = (query.search as string)?.trim() ?? "";
        const branchId = query.branchId as string;
        const department = query.department as string;
        const isActive = query.isActive !== undefined ? query.isActive === "true" : undefined;

        const conditions = [];

        if (search) {
            conditions.push(
                or(
                    like(sql`LOWER(${employees.fullName})`, `%${search.toLowerCase()}%`),
                    like(sql`LOWER(${employees.nik})`, `%${search.toLowerCase()}%`),
                    like(sql`LOWER(${employees.position})`, `%${search.toLowerCase()}%`),
                    like(sql`LOWER(${employees.phone})`, `%${search.toLowerCase()}%`),
                ),
            );
        }

        if (branchId) {
            conditions.push(eq(employees.branchId, branchId));
        }

        if (department) {
            conditions.push(eq(employees.department, department));
        }

        if (isActive !== undefined) {
            conditions.push(eq(employees.isActive, isActive));
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const [employeeList, totalCount] = await Promise.all([
            db
                .select({
                    id: employees.id,
                    nik: employees.nik,
                    fullName: employees.fullName,
                    phone: employees.phone,
                    email: employees.email,
                    idCardNumber: employees.idCardNumber,
                    department: employees.department,
                    position: employees.position,
                    branchId: employees.branchId,
                    branchName: branches.name,
                    userId: employees.userId,
                    userUsername: users.username,
                    userDisplayName: users.displayName,
                    defaultShiftId: employees.defaultShiftId,
                    defaultShiftName: workShifts.name,
                    employmentStatus: employees.employmentStatus,
                    joinDate: employees.joinDate,
                    endDate: employees.endDate,
                    baseSalary: employees.baseSalary,
                    dailyAllowance: employees.dailyAllowance,
                    bankName: employees.bankName,
                    bankAccountNo: employees.bankAccountNo,
                    bankAccountHolder: employees.bankAccountHolder,
                    mobilePin: employees.mobilePin,
                    isActive: employees.isActive,
                    createdAt: employees.createdAt,
                })
                .from(employees)
                .leftJoin(branches, eq(employees.branchId, branches.id))
                .leftJoin(users, eq(employees.userId, users.id))
                .leftJoin(workShifts, eq(employees.defaultShiftId, workShifts.id))
                .where(whereClause)
                .orderBy(employees.fullName)
                .limit(pageSize)
                .offset(offset),
            db
                .select({ count: sql<number>`count(*)` })
                .from(employees)
                .where(whereClause),
        ]);

        const total = Number(totalCount[0]?.count || 0);

        return res.json({
            rows: employeeList.map((e) => ({
                ...e,
                baseSalary: Number(e.baseSalary || 0),
                dailyAllowance: Number(e.dailyAllowance || 0),
            })),
            rowCount: total,
            pageCount: Math.ceil(total / pageSize),
            pageIndex,
            pageSize,
        });
    } catch (error) {
        console.error("Error fetching employees:", error);
        return res.status(500).json({ message: "Failed to fetch employees" });
    }
};

export const getAllEmployees = async (req: Request, res: Response) => {
    try {
        const branchId = req.query.branchId as string;
        const conditions = [eq(employees.isActive, true)];
        if (branchId) {
            conditions.push(eq(employees.branchId, branchId));
        }

        const list = await db
            .select({
                id: employees.id,
                nik: employees.nik,
                fullName: employees.fullName,
                department: employees.department,
                position: employees.position,
                branchId: employees.branchId,
                branchName: branches.name,
                baseSalary: employees.baseSalary,
                dailyAllowance: employees.dailyAllowance,
                defaultShiftId: employees.defaultShiftId,
            })
            .from(employees)
            .leftJoin(branches, eq(employees.branchId, branches.id))
            .where(and(...conditions))
            .orderBy(employees.fullName);

        res.status(200).json(
            list.map((e) => ({
                ...e,
                baseSalary: Number(e.baseSalary || 0),
                dailyAllowance: Number(e.dailyAllowance || 0),
            })),
        );
    } catch (error) {
        console.error("Error fetching all employees:", error);
        res.status(500).json({ message: "Failed to fetch employees" });
    }
};

export const getEmployeeById = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const [emp] = await db
            .select({
                id: employees.id,
                nik: employees.nik,
                fullName: employees.fullName,
                phone: employees.phone,
                email: employees.email,
                idCardNumber: employees.idCardNumber,
                department: employees.department,
                position: employees.position,
                branchId: employees.branchId,
                branchName: branches.name,
                userId: employees.userId,
                userUsername: users.username,
                userDisplayName: users.displayName,
                defaultShiftId: employees.defaultShiftId,
                defaultShiftName: workShifts.name,
                employmentStatus: employees.employmentStatus,
                joinDate: employees.joinDate,
                endDate: employees.endDate,
                baseSalary: employees.baseSalary,
                dailyAllowance: employees.dailyAllowance,
                bankName: employees.bankName,
                bankAccountNo: employees.bankAccountNo,
                bankAccountHolder: employees.bankAccountHolder,
                mobilePin: employees.mobilePin,
                isActive: employees.isActive,
                createdAt: employees.createdAt,
            })
            .from(employees)
            .leftJoin(branches, eq(employees.branchId, branches.id))
            .leftJoin(users, eq(employees.userId, users.id))
            .leftJoin(workShifts, eq(employees.defaultShiftId, workShifts.id))
            .where(eq(employees.id, id))
            .limit(1);

        if (!emp) {
            return res.status(404).json({ message: "Employee not found" });
        }

        return res.status(200).json({
            ...emp,
            baseSalary: Number(emp.baseSalary || 0),
            dailyAllowance: Number(emp.dailyAllowance || 0),
        });
    } catch (error) {
        console.error("Error fetching employee:", error);
        return res.status(500).json({ message: "Failed to fetch employee" });
    }
};

export const createEmployee = async (req: Request, res: Response) => {
    const parsed = employeeInsertSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    try {
        const [existingNik] = await db
            .select({ id: employees.id })
            .from(employees)
            .where(eq(employees.nik, parsed.data.nik))
            .limit(1);

        if (existingNik) {
            return res.status(409).json({ message: "NIK already registered" });
        }

        const [newEmployee] = await db
            .insert(employees)
            .values({
                ...parsed.data,
                userId: parsed.data.userId || null,
                defaultShiftId: parsed.data.defaultShiftId || null,
                endDate: parsed.data.endDate || null,
                email: parsed.data.email || null,
            })
            .returning();

        logAction(req, {
            action: "insert",
            table: "employees",
            data: newEmployee,
            userId: req.user?.id || "system",
            msg: `Created employee "${newEmployee.fullName}" (${newEmployee.nik})`,
        });

        return res.status(201).json({
            message: "Employee created successfully",
            employee: newEmployee,
        });
    } catch (error) {
        console.error("Error creating employee:", error);
        return res.status(500).json({ message: "Failed to create employee" });
    }
};

export const updateEmployee = async (req: Request, res: Response) => {
    const parsed = employeeUpdateSchema.safeParse({
        ...req.body,
        id: req.params.id || req.body.id,
    });
    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    try {
        const [existing] = await db
            .select()
            .from(employees)
            .where(eq(employees.id, parsed.data.id))
            .limit(1);

        if (!existing) {
            return res.status(404).json({ message: "Employee not found" });
        }

        if (parsed.data.nik !== existing.nik) {
            const [nikConflict] = await db
                .select({ id: employees.id })
                .from(employees)
                .where(eq(employees.nik, parsed.data.nik))
                .limit(1);

            if (nikConflict) {
                return res.status(409).json({ message: "NIK already in use by another employee" });
            }
        }

        const [updatedEmployee] = await db
            .update(employees)
            .set({
                ...parsed.data,
                userId: parsed.data.userId || null,
                defaultShiftId: parsed.data.defaultShiftId || null,
                endDate: parsed.data.endDate || null,
                email: parsed.data.email || null,
                updatedAt: new Date(),
            })
            .where(eq(employees.id, parsed.data.id))
            .returning();

        logAction(req, {
            action: "update",
            table: "employees",
            data: updatedEmployee,
            userId: req.user?.id || "system",
            msg: `Updated employee "${updatedEmployee.fullName}"`,
        });

        return res.status(200).json({
            message: "Employee updated successfully",
            employee: updatedEmployee,
        });
    } catch (error) {
        console.error("Error updating employee:", error);
        return res.status(500).json({ message: "Failed to update employee" });
    }
};

export const deleteEmployee = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        // Toggle isActive = false to preserve attendance & payroll integrity
        const [updated] = await db
            .update(employees)
            .set({ isActive: false, updatedAt: new Date() })
            .where(eq(employees.id, id))
            .returning();

        if (!updated) {
            return res.status(404).json({ message: "Employee not found" });
        }

        return res.status(200).json({ message: "Employee deactivated successfully" });
    } catch (error) {
        console.error("Error deleting employee:", error);
        return res.status(500).json({ message: "Failed to deactivate employee" });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// ATTENDANCE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculates late minutes based on clock-in time and shift start time + grace period.
 */
function calculateLateMinutes(clockInDate: Date, shiftStartTime: string, graceMinutes: number): number {
    const [startH, startM] = shiftStartTime.split(":").map(Number);
    const clockInH = clockInDate.getHours();
    const clockInM = clockInDate.getMinutes();

    const shiftTotalMinutes = startH * 60 + startM;
    const clockInTotalMinutes = clockInH * 60 + clockInM;

    const diff = clockInTotalMinutes - shiftTotalMinutes;
    if (diff > graceMinutes) {
        return diff;
    }
    return 0;
}

/**
 * Calculates overtime hours if clock-out is past shift end time.
 */
function calculateOvertimeHours(clockOutDate: Date, shiftEndTime: string): number {
    const [endH, endM] = shiftEndTime.split(":").map(Number);
    const clockOutH = clockOutDate.getHours();
    const clockOutM = clockOutDate.getMinutes();

    const shiftEndTotalMinutes = endH * 60 + endM;
    const clockOutTotalMinutes = clockOutH * 60 + clockOutM;

    const diffMinutes = clockOutTotalMinutes - shiftEndTotalMinutes;
    if (diffMinutes > 30) {
        // Round to nearest 0.5 hour
        const hours = diffMinutes / 60;
        return Math.round(hours * 2) / 2;
    }
    return 0;
}

export const getAttendances = async (req: Request, res: Response) => {
    try {
        const query = req.query;
        const startDate = query.startDate as string;
        const endDate = query.endDate as string;
        const employeeId = query.employeeId as string;
        const branchId = query.branchId as string;
        const status = query.status as string;

        const conditions = [];

        if (startDate && endDate) {
            conditions.push(gte(attendances.date, startDate));
            conditions.push(lte(attendances.date, endDate));
        } else if (startDate) {
            conditions.push(eq(attendances.date, startDate));
        }

        if (employeeId) {
            conditions.push(eq(attendances.employeeId, employeeId));
        }

        if (status) {
            conditions.push(eq(attendances.status, status));
        }

        if (branchId) {
            conditions.push(eq(employees.branchId, branchId));
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const list = await db
            .select({
                id: attendances.id,
                employeeId: attendances.employeeId,
                employeeNik: employees.nik,
                employeeName: employees.fullName,
                employeeDepartment: employees.department,
                branchId: employees.branchId,
                branchName: branches.name,
                shiftId: attendances.shiftId,
                shiftName: workShifts.name,
                shiftStartTime: workShifts.startTime,
                shiftEndTime: workShifts.endTime,
                date: attendances.date,
                clockIn: attendances.clockIn,
                clockOut: attendances.clockOut,
                clockInPhoto: attendances.clockInPhoto,
                clockInLocation: attendances.clockInLocation,
                clockOutPhoto: attendances.clockOutPhoto,
                clockOutLocation: attendances.clockOutLocation,
                status: attendances.status,
                lateMinutes: attendances.lateMinutes,
                overtimeHours: attendances.overtimeHours,
                notes: attendances.notes,
                createdAt: attendances.createdAt,
            })
            .from(attendances)
            .innerJoin(employees, eq(attendances.employeeId, employees.id))
            .leftJoin(branches, eq(employees.branchId, branches.id))
            .leftJoin(workShifts, eq(attendances.shiftId, workShifts.id))
            .where(whereClause)
            .orderBy(desc(attendances.date), desc(attendances.clockIn));

        return res.status(200).json(
            list.map((a) => ({
                ...a,
                lateMinutes: Number(a.lateMinutes || 0),
                overtimeHours: Number(a.overtimeHours || 0),
            })),
        );
    } catch (error) {
        console.error("Error fetching attendances:", error);
        return res.status(500).json({ message: "Failed to fetch attendances" });
    }
};

export const recordClockIn = async (req: Request, res: Response) => {
    const parsed = attendanceClockInSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    const { employeeId, clockInLocation, clockInPhoto, notes } = parsed.data;
    const now = parsed.data.time ? new Date(parsed.data.time) : new Date();
    const dateStr = parsed.data.date || now.toISOString().slice(0, 10);

    try {
        // Verify employee
        const [emp] = await db
            .select()
            .from(employees)
            .where(eq(employees.id, employeeId))
            .limit(1);

        if (!emp || !emp.isActive) {
            return res.status(404).json({ message: "Active employee not found" });
        }

        // Check if attendance already exists for this day
        const [existing] = await db
            .select()
            .from(attendances)
            .where(
                and(
                    eq(attendances.employeeId, employeeId),
                    eq(attendances.date, dateStr),
                ),
            )
            .limit(1);

        if (existing && existing.clockIn) {
            return res.status(400).json({
                message: "Employee already clocked in for this date",
                attendance: existing,
            });
        }

        // Get shift
        const shiftId = parsed.data.shiftId || emp.defaultShiftId;
        let shift = null;
        if (shiftId) {
            const [s] = await db
                .select()
                .from(workShifts)
                .where(eq(workShifts.id, shiftId))
                .limit(1);
            shift = s;
        }

        if (!shift) {
            // Pick first active shift if none assigned
            const [defaultShift] = await db
                .select()
                .from(workShifts)
                .where(eq(workShifts.isActive, true))
                .limit(1);
            shift = defaultShift;
        }

        let lateMinutes = 0;
        let status = "present";

        if (shift) {
            lateMinutes = calculateLateMinutes(now, shift.startTime, shift.gracePeriodMinutes || 0);
            if (lateMinutes > 0) {
                status = "late";
            }
        }

        let result;
        if (existing) {
            // Update existing placeholder
            const [updated] = await db
                .update(attendances)
                .set({
                    shiftId: shift?.id || null,
                    clockIn: now,
                    clockInLocation: clockInLocation || null,
                    clockInPhoto: clockInPhoto || null,
                    status,
                    lateMinutes,
                    notes: notes || existing.notes,
                })
                .where(eq(attendances.id, existing.id))
                .returning();
            result = updated;
        } else {
            const [inserted] = await db
                .insert(attendances)
                .values({
                    employeeId,
                    shiftId: shift?.id || null,
                    date: dateStr,
                    clockIn: now,
                    clockInLocation: clockInLocation || null,
                    clockInPhoto: clockInPhoto || null,
                    status,
                    lateMinutes,
                    overtimeHours: 0,
                    notes: notes || null,
                })
                .returning();
            result = inserted;
        }

        return res.status(200).json({
            message: status === "late" ? `Clock in recorded (Late ${lateMinutes} mins)` : "Clock in recorded on time",
            attendance: result,
        });
    } catch (error) {
        console.error("Error recording clock in:", error);
        return res.status(500).json({ message: "Failed to record clock in" });
    }
};

export const recordClockOut = async (req: Request, res: Response) => {
    const parsed = attendanceClockOutSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    const { employeeId, clockOutLocation, clockOutPhoto, notes } = parsed.data;
    const now = parsed.data.time ? new Date(parsed.data.time) : new Date();
    const dateStr = now.toISOString().slice(0, 10);

    try {
        const [existing] = await db
            .select()
            .from(attendances)
            .where(
                and(
                    eq(attendances.employeeId, employeeId),
                    eq(attendances.date, dateStr),
                ),
            )
            .limit(1);

        if (!existing || !existing.clockIn) {
            return res.status(400).json({
                message: "No clock-in record found for today. Please clock in first.",
            });
        }

        // Get shift
        let overtimeHours = 0;
        if (existing.shiftId) {
            const [shift] = await db
                .select()
                .from(workShifts)
                .where(eq(workShifts.id, existing.shiftId))
                .limit(1);
            if (shift) {
                overtimeHours = calculateOvertimeHours(now, shift.endTime);
            }
        }

        const [updated] = await db
            .update(attendances)
            .set({
                clockOut: now,
                clockOutLocation: clockOutLocation || null,
                clockOutPhoto: clockOutPhoto || null,
                overtimeHours,
                notes: notes ? (existing.notes ? `${existing.notes}; ${notes}` : notes) : existing.notes,
            })
            .where(eq(attendances.id, existing.id))
            .returning();

        return res.status(200).json({
            message: overtimeHours > 0 ? `Clock out recorded (Overtime ${overtimeHours} hrs)` : "Clock out recorded",
            attendance: updated,
        });
    } catch (error) {
        console.error("Error recording clock out:", error);
        return res.status(500).json({ message: "Failed to record clock out" });
    }
};

export const manualAttendanceEntry = async (req: Request, res: Response) => {
    const parsed = attendanceManualSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    const data = parsed.data;

    try {
        if (data.id) {
            const [updated] = await db
                .update(attendances)
                .set({
                    employeeId: data.employeeId,
                    shiftId: data.shiftId || null,
                    date: data.date,
                    clockIn: data.clockIn ? new Date(data.clockIn) : null,
                    clockOut: data.clockOut ? new Date(data.clockOut) : null,
                    status: data.status,
                    lateMinutes: data.lateMinutes,
                    overtimeHours: data.overtimeHours,
                    notes: data.notes || null,
                })
                .where(eq(attendances.id, data.id))
                .returning();

            return res.status(200).json({
                message: "Attendance entry updated successfully",
                attendance: updated,
            });
        } else {
            // Check if attendance already exists on that date
            const [existing] = await db
                .select()
                .from(attendances)
                .where(
                    and(
                        eq(attendances.employeeId, data.employeeId),
                        eq(attendances.date, data.date),
                    ),
                )
                .limit(1);

            if (existing) {
                return res.status(409).json({
                    message: "Attendance entry for this employee on this date already exists. Please edit the existing entry.",
                });
            }

            const [inserted] = await db
                .insert(attendances)
                .values({
                    employeeId: data.employeeId,
                    shiftId: data.shiftId || null,
                    date: data.date,
                    clockIn: data.clockIn ? new Date(data.clockIn) : null,
                    clockOut: data.clockOut ? new Date(data.clockOut) : null,
                    status: data.status,
                    lateMinutes: data.lateMinutes,
                    overtimeHours: data.overtimeHours,
                    notes: data.notes || null,
                })
                .returning();

            return res.status(201).json({
                message: "Attendance entry created successfully",
                attendance: inserted,
            });
        }
    } catch (error) {
        console.error("Error saving attendance entry:", error);
        return res.status(500).json({ message: "Failed to save attendance entry" });
    }
};

export const deleteAttendance = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        await db.delete(attendances).where(eq(attendances.id, id));
        return res.status(200).json({ message: "Attendance record deleted successfully" });
    } catch (error) {
        console.error("Error deleting attendance:", error);
        return res.status(500).json({ message: "Failed to delete attendance" });
    }
};

export const getAttendanceSummary = async (req: Request, res: Response) => {
    try {
        const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
        const branchId = req.query.branchId as string;

        const conditions = [eq(attendances.date, date)];
        if (branchId) {
            conditions.push(eq(employees.branchId, branchId));
        }

        const rows = await db
            .select({
                status: attendances.status,
                count: sql<number>`count(*)`,
            })
            .from(attendances)
            .innerJoin(employees, eq(attendances.employeeId, employees.id))
            .where(and(...conditions))
            .groupBy(attendances.status);

        const summary: Record<string, number> = {
            present: 0,
            late: 0,
            early_leave: 0,
            sick: 0,
            leave: 0,
            alpha: 0,
            holiday: 0,
            total: 0,
        };

        for (const r of rows) {
            const cnt = Number(r.count || 0);
            summary[r.status] = cnt;
            summary.total += cnt;
        }

        return res.status(200).json(summary);
    } catch (error) {
        console.error("Error fetching attendance summary:", error);
        return res.status(500).json({ message: "Failed to fetch summary" });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// PAYROLL
// ─────────────────────────────────────────────────────────────────────────────

export const generateMonthlyPayroll = async (req: Request, res: Response) => {
    const parsed = generatePayrollSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    const { period, startDate, endDate, branchId, employeeId, lateDeductionPerMinute, overtimeHourlyRate } =
        parsed.data;

    try {
        const empConditions = [eq(employees.isActive, true)];
        if (employeeId) {
            empConditions.push(eq(employees.id, employeeId));
        }
        if (branchId) {
            empConditions.push(eq(employees.branchId, branchId));
        }

        const activeEmployees = await db
            .select()
            .from(employees)
            .where(and(...empConditions));

        if (activeEmployees.length === 0) {
            return res.status(404).json({ message: "No active employees found matching criteria" });
        }

        const generatedList = [];
        const cleanPeriod = period.replace("-", "");

        // Find current sequence for invoice
        const lastPayroll = await db
            .select({ invoice: payrolls.invoice })
            .from(payrolls)
            .where(like(payrolls.invoice, `PAY-${cleanPeriod}-%`))
            .orderBy(desc(payrolls.invoice))
            .limit(1);

        let nextSeq = 1;
        if (lastPayroll[0]?.invoice) {
            const parts = lastPayroll[0].invoice.split("-");
            const num = parseInt(parts[parts.length - 1], 10);
            if (!isNaN(num)) nextSeq = num + 1;
        }

        for (const emp of activeEmployees) {
            // Query attendances for this employee in date range
            const empAttendances = await db
                .select()
                .from(attendances)
                .where(
                    and(
                        eq(attendances.employeeId, emp.id),
                        gte(attendances.date, startDate),
                        lte(attendances.date, endDate),
                    ),
                );

            let presentDays = 0;
            let lateMinutes = 0;
            let overtimeHours = 0;

            for (const att of empAttendances) {
                if (["present", "late", "early_leave"].includes(att.status) || att.clockIn) {
                    presentDays += 1;
                }
                lateMinutes += Number(att.lateMinutes || 0);
                overtimeHours += Number(att.overtimeHours || 0);
            }

            const baseSalary = Number(emp.baseSalary || 0);
            const dailyAllowance = Number(emp.dailyAllowance || 0);
            const totalAllowance = dailyAllowance * presentDays;

            // Depnaker standard hourly rate: baseSalary / 173, or custom rate
            const hourlyRate = overtimeHourlyRate !== null && overtimeHourlyRate !== undefined && overtimeHourlyRate > 0
                ? overtimeHourlyRate
                : (baseSalary > 0 ? Math.round(baseSalary / 173) : 0);

            const totalOvertimePay = Math.round(overtimeHours * hourlyRate);
            const lateDeduction = Math.round(lateMinutes * (lateDeductionPerMinute || 0));
            const totalDeduction = lateDeduction;
            const totalIncentive = 0;
            const netSalary = Math.max(0, baseSalary + totalAllowance + totalOvertimePay + totalIncentive - totalDeduction);

            // Check if payroll already exists for this period and employee
            const [existingPayroll] = await db
                .select()
                .from(payrolls)
                .where(
                    and(
                        eq(payrolls.employeeId, emp.id),
                        eq(payrolls.period, period),
                    ),
                )
                .limit(1);

            if (existingPayroll) {
                // Update draft if not already paid
                if (existingPayroll.status === "paid") {
                    generatedList.push(existingPayroll);
                    continue;
                }

                const [updated] = await db
                    .update(payrolls)
                    .set({
                        startDate,
                        endDate,
                        presentDays,
                        lateMinutes,
                        overtimeHours,
                        baseSalary,
                        totalAllowance,
                        totalOvertimePay,
                        totalIncentive: Number(existingPayroll.totalIncentive || 0),
                        totalDeduction,
                        netSalary: Math.max(
                            0,
                            baseSalary +
                            totalAllowance +
                            totalOvertimePay +
                            Number(existingPayroll.totalIncentive || 0) -
                            totalDeduction,
                        ),
                    })
                    .where(eq(payrolls.id, existingPayroll.id))
                    .returning();
                generatedList.push(updated);
            } else {
                const invoice = `PAY-${cleanPeriod}-${String(nextSeq++).padStart(4, "0")}`;
                const [created] = await db
                    .insert(payrolls)
                    .values({
                        invoice,
                        period,
                        employeeId: emp.id,
                        startDate,
                        endDate,
                        presentDays,
                        lateMinutes,
                        overtimeHours,
                        baseSalary,
                        totalAllowance,
                        totalOvertimePay,
                        totalIncentive,
                        totalDeduction,
                        netSalary,
                        status: "draft",
                    })
                    .returning();
                generatedList.push(created);
            }
        }

        return res.status(200).json({
            message: `Successfully generated payroll for ${generatedList.length} employee(s)`,
            count: generatedList.length,
            payrolls: generatedList,
        });
    } catch (error) {
        console.error("Error generating payroll:", error);
        return res.status(500).json({ message: "Failed to generate payroll" });
    }
};

export const getPayrolls = async (req: Request, res: Response) => {
    try {
        const query = req.query;
        const pageIndex = parseInt(query.pageIndex as string) || 0;
        const pageSize = parseInt(query.pageSize as string) || 10;
        const offset = pageIndex * pageSize;

        const period = query.period as string;
        const branchId = query.branchId as string;
        const status = query.status as string;
        const search = (query.search as string)?.trim() ?? "";

        const conditions = [];

        if (period) {
            conditions.push(eq(payrolls.period, period));
        }

        if (status) {
            conditions.push(eq(payrolls.status, status));
        }

        if (branchId) {
            conditions.push(eq(employees.branchId, branchId));
        }

        if (search) {
            conditions.push(
                or(
                    like(sql`LOWER(${employees.fullName})`, `%${search.toLowerCase()}%`),
                    like(sql`LOWER(${employees.nik})`, `%${search.toLowerCase()}%`),
                    like(sql`LOWER(${payrolls.invoice})`, `%${search.toLowerCase()}%`),
                ),
            );
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const [list, totalCount] = await Promise.all([
            db
                .select({
                    id: payrolls.id,
                    invoice: payrolls.invoice,
                    period: payrolls.period,
                    employeeId: payrolls.employeeId,
                    employeeNik: employees.nik,
                    employeeName: employees.fullName,
                    employeeDepartment: employees.department,
                    employeePosition: employees.position,
                    branchId: employees.branchId,
                    branchName: branches.name,
                    bankName: employees.bankName,
                    bankAccountNo: employees.bankAccountNo,
                    bankAccountHolder: employees.bankAccountHolder,
                    startDate: payrolls.startDate,
                    endDate: payrolls.endDate,
                    presentDays: payrolls.presentDays,
                    lateMinutes: payrolls.lateMinutes,
                    overtimeHours: payrolls.overtimeHours,
                    baseSalary: payrolls.baseSalary,
                    totalAllowance: payrolls.totalAllowance,
                    totalOvertimePay: payrolls.totalOvertimePay,
                    totalIncentive: payrolls.totalIncentive,
                    totalDeduction: payrolls.totalDeduction,
                    netSalary: payrolls.netSalary,
                    status: payrolls.status,
                    paidAt: payrolls.paidAt,
                    notes: payrolls.notes,
                    createdAt: payrolls.createdAt,
                })
                .from(payrolls)
                .innerJoin(employees, eq(payrolls.employeeId, employees.id))
                .leftJoin(branches, eq(employees.branchId, branches.id))
                .where(whereClause)
                .orderBy(desc(payrolls.createdAt))
                .limit(pageSize)
                .offset(offset),
            db
                .select({ count: sql<number>`count(*)` })
                .from(payrolls)
                .innerJoin(employees, eq(payrolls.employeeId, employees.id))
                .where(whereClause),
        ]);

        const total = Number(totalCount[0]?.count || 0);

        return res.json({
            rows: list.map((p) => ({
                ...p,
                baseSalary: Number(p.baseSalary || 0),
                totalAllowance: Number(p.totalAllowance || 0),
                totalOvertimePay: Number(p.totalOvertimePay || 0),
                totalIncentive: Number(p.totalIncentive || 0),
                totalDeduction: Number(p.totalDeduction || 0),
                netSalary: Number(p.netSalary || 0),
                overtimeHours: Number(p.overtimeHours || 0),
            })),
            rowCount: total,
            pageCount: Math.ceil(total / pageSize),
            pageIndex,
            pageSize,
        });
    } catch (error) {
        console.error("Error fetching payrolls:", error);
        return res.status(500).json({ message: "Failed to fetch payrolls" });
    }
};

export const getPayrollById = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const [payroll] = await db
            .select({
                id: payrolls.id,
                invoice: payrolls.invoice,
                period: payrolls.period,
                employeeId: payrolls.employeeId,
                employeeNik: employees.nik,
                employeeName: employees.fullName,
                employeeDepartment: employees.department,
                employeePosition: employees.position,
                employeePhone: employees.phone,
                branchId: employees.branchId,
                branchName: branches.name,
                branchAddress: branches.address,
                bankName: employees.bankName,
                bankAccountNo: employees.bankAccountNo,
                bankAccountHolder: employees.bankAccountHolder,
                startDate: payrolls.startDate,
                endDate: payrolls.endDate,
                presentDays: payrolls.presentDays,
                lateMinutes: payrolls.lateMinutes,
                overtimeHours: payrolls.overtimeHours,
                baseSalary: payrolls.baseSalary,
                dailyAllowance: employees.dailyAllowance,
                totalAllowance: payrolls.totalAllowance,
                totalOvertimePay: payrolls.totalOvertimePay,
                totalIncentive: payrolls.totalIncentive,
                totalDeduction: payrolls.totalDeduction,
                netSalary: payrolls.netSalary,
                status: payrolls.status,
                paidAt: payrolls.paidAt,
                notes: payrolls.notes,
                createdAt: payrolls.createdAt,
            })
            .from(payrolls)
            .innerJoin(employees, eq(payrolls.employeeId, employees.id))
            .leftJoin(branches, eq(employees.branchId, branches.id))
            .where(eq(payrolls.id, id))
            .limit(1);

        if (!payroll) {
            return res.status(404).json({ message: "Payroll record not found" });
        }

        return res.status(200).json({
            ...payroll,
            baseSalary: Number(payroll.baseSalary || 0),
            dailyAllowance: Number(payroll.dailyAllowance || 0),
            totalAllowance: Number(payroll.totalAllowance || 0),
            totalOvertimePay: Number(payroll.totalOvertimePay || 0),
            totalIncentive: Number(payroll.totalIncentive || 0),
            totalDeduction: Number(payroll.totalDeduction || 0),
            netSalary: Number(payroll.netSalary || 0),
            overtimeHours: Number(payroll.overtimeHours || 0),
        });
    } catch (error) {
        console.error("Error fetching payroll details:", error);
        return res.status(500).json({ message: "Failed to fetch payroll details" });
    }
};

export const updatePayroll = async (req: Request, res: Response) => {
    const parsed = payrollUpdateSchema.safeParse({
        ...req.body,
        id: req.params.id || req.body.id,
    });
    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues,
        });
    }

    try {
        const [existing] = await db
            .select()
            .from(payrolls)
            .where(eq(payrolls.id, parsed.data.id))
            .limit(1);

        if (!existing) {
            return res.status(404).json({ message: "Payroll not found" });
        }

        const baseSalary = Number(existing.baseSalary || 0);
        const totalAllowance = Number(existing.totalAllowance || 0);
        const totalOvertimePay = Number(existing.totalOvertimePay || 0);
        const totalIncentive = parsed.data.totalIncentive !== undefined
            ? Number(parsed.data.totalIncentive)
            : Number(existing.totalIncentive || 0);
        const totalDeduction = parsed.data.totalDeduction !== undefined
            ? Number(parsed.data.totalDeduction)
            : Number(existing.totalDeduction || 0);

        const netSalary = Math.max(0, baseSalary + totalAllowance + totalOvertimePay + totalIncentive - totalDeduction);

        const paidAt = parsed.data.status === "paid"
            ? (existing.paidAt || (parsed.data.paidAt ? new Date(parsed.data.paidAt) : new Date()))
            : (parsed.data.status === "draft" ? null : existing.paidAt);

        const [updated] = await db
            .update(payrolls)
            .set({
                status: parsed.data.status || existing.status,
                totalIncentive,
                totalDeduction,
                netSalary,
                paidAt,
                notes: parsed.data.notes !== undefined ? parsed.data.notes : existing.notes,
            })
            .where(eq(payrolls.id, parsed.data.id))
            .returning();

        return res.status(200).json({
            message: "Payroll updated successfully",
            payroll: updated,
        });
    } catch (error) {
        console.error("Error updating payroll:", error);
        return res.status(500).json({ message: "Failed to update payroll" });
    }
};

export const deletePayroll = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const [existing] = await db
            .select()
            .from(payrolls)
            .where(eq(payrolls.id, id))
            .limit(1);

        if (!existing) {
            return res.status(404).json({ message: "Payroll not found" });
        }

        if (existing.status === "paid") {
            return res.status(400).json({ message: "Cannot delete a paid payroll" });
        }

        await db.delete(payrolls).where(eq(payrolls.id, id));
        return res.status(200).json({ message: "Payroll deleted successfully" });
    } catch (error) {
        console.error("Error deleting payroll:", error);
        return res.status(500).json({ message: "Failed to delete payroll" });
    }
};

