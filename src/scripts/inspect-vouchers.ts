import sqlServer from "mssql";
import dotenv from "dotenv";
dotenv.config();

const sqlConfig: sqlServer.config = {
    user: process.env.MSSQL_USER || "api",
    password: process.env.MSSQL_PASSWORD || "Hrd12345",
    database: process.env.MSSQL_DATABASE || "dbPrimaNusantara",
    server: process.env.MSSQL_HOST || "192.168.5.100",
    port: Number(process.env.MSSQL_PORT) || 1433,
    options: {
        encrypt: false,
        trustServerCertificate: true,
    },
};

async function inspectPaymentVouchers() {
    const pool = await sqlServer.connect(sqlConfig);

    // 1. Group H_Notes by CodeTr or prefix
    const hNotesSummary = await pool.request().query(`
        SELECT 
            LEFT(IdNotes, 6) as prefix,
            COUNT(*) as total_vouchers,
            MIN(DateNotes) as minDate,
            MAX(DateNotes) as maxDate
        FROM H_Notes
        GROUP BY LEFT(IdNotes, 6)
        ORDER BY total_vouchers DESC
    `);
    console.log("H_Notes prefixes:", hNotesSummary.recordset);

    // 2. Vouchers that have rows in D_Notes2
    const vouchersInDnotes2 = await pool.request().query(`
        SELECT 
            LEFT(n2.IdNotes, 6) as prefix,
            COUNT(DISTINCT n2.IdNotes) as total_vouchers,
            COUNT(*) as total_lines,
            SUM(ABS(n2.ClearedAmount)) as total_amount
        FROM D_Notes2 n2
        GROUP BY LEFT(n2.IdNotes, 6)
    `);
    console.log("\nVouchers in D_Notes2 (Pelunasan Piutang & Hutang):", vouchersInDnotes2.recordset);

    // 3. Sample BD-BCP (Pelunasan Hutang)
    const bcpSampleH = await pool.request().query(`
        SELECT TOP 2 * FROM H_Notes WHERE IdNotes LIKE 'BD-BCP%'
    `);
    console.log("\nSample H_Notes BD-BCP:", bcpSampleH.recordset);

    const bcpSampleD2 = await pool.request().query(`
        SELECT TOP 3 * FROM D_Notes2 WHERE IdNotes = '${bcpSampleH.recordset[0]?.IdNotes}'
    `);
    console.log("\nSample D_Notes2 for that voucher:", bcpSampleD2.recordset);

    const bcpSampleD1 = await pool.request().query(`
        SELECT * FROM D_Notes1 WHERE IdNotes = '${bcpSampleH.recordset[0]?.IdNotes}'
    `);
    console.log("\nSample D_Notes1 for that voucher:", bcpSampleD1.recordset);

    // 4. Sample BD-BCA (Pelunasan Piutang)
    const bcaSampleH = await pool.request().query(`
        SELECT TOP 2 * FROM H_Notes WHERE IdNotes LIKE 'BD-BCA%'
    `);
    console.log("\nSample H_Notes BD-BCA:", bcaSampleH.recordset);

    const bcaSampleD2 = await pool.request().query(`
        SELECT TOP 3 * FROM D_Notes2 WHERE IdNotes = '${bcaSampleH.recordset[0]?.IdNotes}'
    `);
    console.log("\nSample D_Notes2 for BD-BCA:", bcaSampleD2.recordset);

    const bcaSampleD1 = await pool.request().query(`
        SELECT * FROM D_Notes1 WHERE IdNotes = '${bcaSampleH.recordset[0]?.IdNotes}'
    `);
    console.log("\nSample D_Notes1 for BD-BCA:", bcaSampleD1.recordset);

    await pool.close();
}

inspectPaymentVouchers().catch(console.error);
