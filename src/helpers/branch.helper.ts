import { Request } from "express";
import { eq, or, inArray, SQL } from "drizzle-orm";
import { db } from "@/db";
import { branches, productBranches } from "@/db/schemas/branch.schema";

let cachedHqBranchId: string | null = null;

export async function getDefaultBranchId(): Promise<string> {
    if (cachedHqBranchId) return cachedHqBranchId;
    const [hq] = await db
        .select({ id: branches.id })
        .from(branches)
        .where(eq(branches.isHq, true))
        .limit(1);
    if (hq) {
        cachedHqBranchId = hq.id;
        return hq.id;
    }
    const [first] = await db
        .select({ id: branches.id })
        .from(branches)
        .limit(1);
    return first?.id || "";
}

export async function resolveBranchId(
    explicitBranchId?: string | null,
    req?: Request,
): Promise<string> {
    if (explicitBranchId) return explicitBranchId;
    if (req) {
        const target = req.activeBranchId || (req.user as any)?.branchId;
        if (target) return target;
    }
    return getDefaultBranchId();
}

/**
 * Resolves the branch code string for invoice prefixing.
 * Returns up to 3 uppercase chars from the active branch's code, or null.
 */
export async function resolveBranchCode(req: Request): Promise<string | null> {
    const branchId = req.activeBranchId || (req.user as any)?.branchId;
    if (!branchId) return null;
    const [branch] = await db
        .select({ code: branches.code })
        .from(branches)
        .where(eq(branches.id, branchId))
        .limit(1);
    if (!branch?.code) return null;
    return branch.code.trim().toUpperCase().slice(0, 3);
}


/**
 * Returns a Drizzle SQL condition to filter a table column by the active branch,
 * or undefined if the user is HQ and viewing all branches.
 */
export function branchScope(column: any, req: Request): SQL | undefined {
    if (req.isHq && !req.activeBranchId) {
        return undefined;
    }
    const targetBranchId = req.activeBranchId || (req.user as any)?.branchId;
    if (!targetBranchId) {
        return undefined;
    }
    return eq(column, targetBranchId);
}

/**
 * Injects branchId into data object for insert / create operations.
 */
export function withBranch<T extends Record<string, any>>(data: T, req: Request): T & { branchId?: string } {
    if (data.branchId) {
        return data;
    }
    const targetBranchId = req.activeBranchId || (req.user as any)?.branchId;
    if (!targetBranchId) {
        return data;
    }
    return {
        ...data,
        branchId: targetBranchId,
    };
}

/**
 * Returns a filter for products:
 * - HQ viewing all: all products
 * - Branch context: products that are global (isGlobal = true) OR assigned to this branch
 */
export function productBranchFilter(productsTable: any, req: Request): SQL | undefined {
    if (req.isHq && !req.activeBranchId) {
        return undefined;
    }
    const targetBranchId = req.activeBranchId || (req.user as any)?.branchId;
    if (!targetBranchId) {
        return undefined;
    }

    const branchProductSubquery = db
        .select({ productId: productBranches.productId })
        .from(productBranches)
        .where(eq(productBranches.branchId, targetBranchId));

    return or(
        eq(productsTable.isGlobal, true),
        inArray(productsTable.id, branchProductSubquery)
    );
}
