import { db } from "../db";
import { sql } from "drizzle-orm";

async function main() {
    console.log("Migrating CRM, Member, Voucher, and Promotion tables...");

    // 1. Add Member columns to contacts table
    await db.execute(sql`
        ALTER TABLE "contacts" 
        ADD COLUMN IF NOT EXISTS "is_member" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "member_code" text,
        ADD COLUMN IF NOT EXISTS "member_tier" text DEFAULT 'standard',
        ADD COLUMN IF NOT EXISTS "points" integer DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "birth_date" date;
    `);
    console.log("Contacts member columns checked/added.");

    // 2. Create promotions table
    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "promotions" (
            "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            "name" text NOT NULL,
            "description" text,
            "type" text NOT NULL DEFAULT 'discount_percentage',
            "discount_percent" numeric(5, 2) DEFAULT '0',
            "discount_amount" numeric(12, 2) DEFAULT '0',
            "min_spend" numeric(12, 2) DEFAULT '0',
            "max_discount" numeric(12, 2) DEFAULT '0',
            "buy_product_id" uuid REFERENCES "products"("id") ON DELETE SET NULL,
            "buy_qty" integer DEFAULT 1,
            "get_product_id" uuid REFERENCES "products"("id") ON DELETE SET NULL,
            "get_qty" integer DEFAULT 1,
            "get_discount_percent" numeric(5, 2) DEFAULT '100',
            "member_tier" text DEFAULT 'all',
            "branch_id" uuid REFERENCES "branches"("id") ON DELETE SET NULL,
            "start_date" timestamp NOT NULL,
            "end_date" timestamp NOT NULL,
            "is_active" boolean NOT NULL DEFAULT true,
            "created_at" timestamp NOT NULL DEFAULT now(),
            "updated_at" timestamp NOT NULL DEFAULT now()
        );
    `);
    console.log("Promotions table checked/created.");

    // 3. Create vouchers table
    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "vouchers" (
            "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            "code" text NOT NULL UNIQUE,
            "name" text NOT NULL,
            "description" text,
            "type" text NOT NULL DEFAULT 'nominal',
            "value" numeric(12, 2) NOT NULL DEFAULT '0',
            "min_spend" numeric(12, 2) DEFAULT '0',
            "max_discount" numeric(12, 2) DEFAULT '0',
            "quota" integer NOT NULL DEFAULT 100,
            "used_count" integer NOT NULL DEFAULT 0,
            "member_only" boolean NOT NULL DEFAULT false,
            "start_date" timestamp NOT NULL,
            "end_date" timestamp NOT NULL,
            "is_active" boolean NOT NULL DEFAULT true,
            "created_at" timestamp NOT NULL DEFAULT now(),
            "updated_at" timestamp NOT NULL DEFAULT now()
        );
    `);
    console.log("Vouchers table checked/created.");

    // 4. Create voucher_usages table
    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "voucher_usages" (
            "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            "voucher_id" uuid NOT NULL REFERENCES "vouchers"("id") ON DELETE CASCADE,
            "transaction_id" uuid REFERENCES "transactions"("id") ON DELETE SET NULL,
            "contact_id" uuid REFERENCES "contacts"("id") ON DELETE SET NULL,
            "discount_amount" numeric(12, 2) NOT NULL DEFAULT '0',
            "used_at" timestamp NOT NULL DEFAULT now()
        );
    `);
    console.log("Voucher usages table checked/created.");

    // 5. Insert sample starter promotions and vouchers if empty
    const result: any = await db.execute(sql`SELECT count(*) as count FROM vouchers;`);
    const rows = result.rows || result;
    const countVal = rows?.[0]?.count ?? 0;
    if (Number(countVal) === 0) {
        await db.execute(sql`
            INSERT INTO vouchers (code, name, description, type, value, min_spend, quota, start_date, end_date, is_active)
            VALUES 
            ('HEMAT10K', 'Voucher Potongan 10rb', 'Diskon langsung Rp 10.000 minimal belanja Rp 50.000', 'nominal', 10000, 50000, 500, now(), now() + interval '30 days', true),
            ('DISKON5', 'Diskon Belanja 5%', 'Potongan 5% maksimal Rp 20.000 untuk semua pelanggan', 'percentage', 5, 20000, 200, now(), now() + interval '60 days', true),
            ('MEMBERVIP', 'Voucher Spesial Member', 'Potongan Rp 25.000 khusus member terdaftar', 'nominal', 25000, 100000, 100, now(), now() + interval '90 days', true);
        `);
        console.log("Sample vouchers seeded.");
    }

    console.log("CRM migration complete!");
    process.exit(0);
}

main().catch((err) => {
    console.error("CRM migration failed:", err);
    process.exit(1);
});
