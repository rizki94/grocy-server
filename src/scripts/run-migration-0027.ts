import { db } from "@/db";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";

async function run() {
    console.log("Running migration 0027: Creating HRD tables...");
    const sqlPath = path.join(__dirname, "../db/migrations/0027_create_hrd_tables.sql");
    const sqlContent = fs.readFileSync(sqlPath, "utf-8");

    // Execute SQL script
    await db.execute(sql.raw(sqlContent));

    // Insert default shift if none exists
    const shiftRes: any = await db.execute(sql`SELECT id FROM work_shifts LIMIT 1`);
    const rows = Array.isArray(shiftRes) ? shiftRes : (shiftRes?.rows || []);
    if (rows.length === 0) {
        console.log("Seeding default work shift (Shift Normal 08:00 - 17:00)...");
        await db.execute(sql`
            INSERT INTO work_shifts (name, start_time, end_time, grace_period_minutes, is_active)
            VALUES 
                ('Shift Pagi (08:00 - 17:00)', '08:00', '17:00', 15, true),
                ('Shift Siang / Kasir (13:00 - 21:00)', '13:00', '21:00', 15, true),
                ('Full Day / Kantor (08:30 - 17:30)', '08:30', '17:30', 15, true);
        `);
    }

    console.log("Successfully executed migration 0027!");
    process.exit(0);
}

run().catch((err) => {
    console.error("Migration 0027 failed:", err);
    process.exit(1);
});
