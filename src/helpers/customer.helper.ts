import { db } from "@/db";
import { contacts } from "@/db/schemas";
import { eq } from "drizzle-orm";

export class CustomerGuardError extends Error {
    public readonly statusCode: number;

    constructor(message: string, statusCode = 400) {
        super(message);
        this.name = "CustomerGuardError";
        this.statusCode = statusCode;
    }
}

/**
 * Ensures the target contact exists, is a customer, and has a Price Group configured.
 */
export async function assertCustomerHasPriceGroup(
    contactId: string,
    dbOrTx: typeof db | any = db,
) {
    const [customer] = await dbOrTx
        .select({
            id: contacts.id,
            name: contacts.name,
            contactType: contacts.contactType,
            priceGroupId: contacts.priceGroupId,
            termOfPayment: contacts.termOfPayment,
            creditLimit: contacts.creditLimit,
            invoiceLimit: contacts.invoiceLimit,
            phone: contacts.phone,
        })
        .from(contacts)
        .where(eq(contacts.id, contactId))
        .limit(1);

    if (!customer || customer.contactType !== "customer") {
        throw new CustomerGuardError("Customer not found", 404);
    }

    if (!customer.priceGroupId) {
        throw new CustomerGuardError(
            `Customer "${customer.name}" does not have a Price Group assigned. Please configure the customer's Price Group before creating or posting transactions.`,
            400,
        );
    }

    return customer;
}

