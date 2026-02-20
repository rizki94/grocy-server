import { db } from "@/db";
import { glAccounts } from "@/db/schemas";
import { eq, sql } from "drizzle-orm";

export async function findGlAccountByCode(code: string) {
    const result = await db
        .select({ id: glAccounts.id })
        .from(glAccounts)
        .where(eq(glAccounts.code, code))
        .limit(1);
    return result[0]?.id;
}

export async function findLeafGlAccounts() {
    return await db
        .select()
        .from(glAccounts)
        .where(
            sql`NOT EXISTS (
        SELECT 1 
        FROM ${glAccounts} child 
        WHERE child.parent_id = ${glAccounts.id}
      )`
        );
}
