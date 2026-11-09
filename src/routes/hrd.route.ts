import {
    createEmployee,
    createWorkShift,
    deleteAttendance,
    deleteEmployee,
    deletePayroll,
    deleteWorkShift,
    getAllEmployees,
    getAttendances,
    getAttendanceSummary,
    getEmployeeById,
    getEmployees,
    getPayrollById,
    getPayrolls,
    getWorkShifts,
    generateMonthlyPayroll,
    manualAttendanceEntry,
    recordClockIn,
    recordClockOut,
    updateEmployee,
    updatePayroll,
    updateWorkShift,
} from "@/controllers/hrd.controller";
import { Router } from "express";

const hrdRouter = Router();

// Work shifts
hrdRouter.get("/shifts", getWorkShifts);
hrdRouter.post("/shifts", createWorkShift);
hrdRouter.put("/shifts/:id", updateWorkShift);
hrdRouter.delete("/shifts/:id", deleteWorkShift);

// Employees
hrdRouter.get("/employees", getEmployees);
hrdRouter.get("/employees/all", getAllEmployees);
hrdRouter.get("/employees/:id", getEmployeeById);
hrdRouter.post("/employees", createEmployee);
hrdRouter.put("/employees/:id", updateEmployee);
hrdRouter.delete("/employees/:id", deleteEmployee);

// Attendance
hrdRouter.get("/attendances", getAttendances);
hrdRouter.get("/attendances/summary", getAttendanceSummary);
hrdRouter.post("/attendances/clock-in", recordClockIn);
hrdRouter.post("/attendances/clock-out", recordClockOut);
hrdRouter.post("/attendances/manual", manualAttendanceEntry);
hrdRouter.delete("/attendances/:id", deleteAttendance);

// Payroll
hrdRouter.get("/payrolls", getPayrolls);
hrdRouter.get("/payrolls/:id", getPayrollById);
hrdRouter.post("/payrolls/generate", generateMonthlyPayroll);
hrdRouter.put("/payrolls/:id", updatePayroll);
hrdRouter.delete("/payrolls/:id", deletePayroll);

export default hrdRouter;

