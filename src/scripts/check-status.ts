import { db } from "../db";
import { transactions } from "../db/schemas";
import { eq } from "drizzle-orm";

async function checkStatus() {
    const id = "8f8d21b9-69b6-4349-b7e0-149e6e207898";
    console.log(`Checking transaction ${id}...`);

    try {
        const [transaction] = await db
            .select()
            .from(transactions)
            .where(eq(transactions.id, id));

        if (transaction) {
            console.log("Transaction Found:", transaction);
            console.log("Status:", transaction.status);
            console.log("Updated At:", transaction.updatedAt);
        } else {
            console.log("Transaction not found.");
        }
    } catch (error) {
        console.error("Error:", error);
    }
    process.exit(0);
}

checkStatus();
