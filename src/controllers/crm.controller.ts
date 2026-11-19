import { db } from "@/db";
import { contacts, promotions, vouchers, voucherUsages, products, priceGroups } from "@/db/schemas";
import { and, desc, eq, ilike, lte, gte, or, sql, count } from "drizzle-orm";
import { Request, Response } from "express";
import { logAction } from "@/utils/log-helper";
import { CacheService } from "@/services/cache-service";

// ==========================================
// VOUCHERS CONTROLLERS
// ==========================================

export async function getPaginatedVouchers(req: Request, res: Response) {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const pageSize = Math.max(1, Number(req.query.pageSize) || 10);
        const search = ((req.query.search as string) || "").trim();
        const status = (req.query.status as string) || "all";
        const offset = (page - 1) * pageSize;

        const conditions = [];

        if (search) {
            conditions.push(
                or(
                    ilike(vouchers.code, `%${search}%`),
                    ilike(vouchers.name, `%${search}%`),
                    ilike(vouchers.description, `%${search}%`)
                )
            );
        }

        const now = new Date();
        if (status === "active") {
            conditions.push(
                and(
                    eq(vouchers.isActive, true),
                    lte(vouchers.startDate, now),
                    gte(vouchers.endDate, now)
                )
            );
        } else if (status === "inactive") {
            conditions.push(eq(vouchers.isActive, false));
        } else if (status === "expired") {
            conditions.push(sql`${vouchers.endDate} < ${now}`);
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const [totalResult] = await db
            .select({ count: count() })
            .from(vouchers)
            .where(whereClause);

        const total = totalResult?.count || 0;

        const items = await db
            .select()
            .from(vouchers)
            .where(whereClause)
            .orderBy(desc(vouchers.createdAt))
            .limit(pageSize)
            .offset(offset);

        res.status(200).json({
            items,
            total,
            page,
            pageSize,
            totalPages: Math.ceil(total / pageSize),
        });
    } catch (error: any) {
        console.error("Error getPaginatedVouchers:", error);
        res.status(500).json({ message: "Failed to fetch vouchers", error: error.message });
    }
}

export async function getVoucherById(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const [voucher] = await db
            .select()
            .from(vouchers)
            .where(eq(vouchers.id, id))
            .limit(1);

        if (!voucher) {
            return res.status(404).json({ message: "Voucher not found" });
        }

        res.status(200).json(voucher);
    } catch (error: any) {
        console.error("Error getVoucherById:", error);
        res.status(500).json({ message: "Failed to fetch voucher", error: error.message });
    }
}

export async function createVoucher(req: Request, res: Response) {
    try {
        const {
            code,
            name,
            description,
            type,
            value,
            minSpend,
            maxDiscount,
            quota,
            memberOnly,
            startDate,
            endDate,
            isActive,
        } = req.body;

        const cleanCode = (code || "").trim().toUpperCase();
        if (!cleanCode) {
            return res.status(400).json({ message: "Kode voucher wajib diisi" });
        }

        const [existing] = await db
            .select()
            .from(vouchers)
            .where(eq(vouchers.code, cleanCode))
            .limit(1);

        if (existing) {
            return res.status(400).json({ message: `Kode voucher "${cleanCode}" sudah digunakan` });
        }

        const [created] = await db
            .insert(vouchers)
            .values({
                code: cleanCode,
                name: name || cleanCode,
                description: description || null,
                type: type || "nominal",
                value: String(value || 0),
                minSpend: String(minSpend || 0),
                maxDiscount: String(maxDiscount || 0),
                quota: Number(quota) || 100,
                memberOnly: Boolean(memberOnly),
                startDate: new Date(startDate || Date.now()),
                endDate: new Date(endDate || Date.now() + 30 * 24 * 60 * 60 * 1000),
                isActive: isActive !== undefined ? Boolean(isActive) : true,
            })
            .returning();

        logAction(req, {
            action: "insert",
            table: "vouchers",
            data: created,
            userId: req.user?.id,
            msg: `Voucher created: ${created.code}`,
        });

        res.status(201).json(created);
    } catch (error: any) {
        console.error("Error createVoucher:", error);
        res.status(500).json({ message: "Failed to create voucher", error: error.message });
    }
}

export async function updateVoucher(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const {
            code,
            name,
            description,
            type,
            value,
            minSpend,
            maxDiscount,
            quota,
            memberOnly,
            startDate,
            endDate,
            isActive,
        } = req.body;

        const cleanCode = code ? code.trim().toUpperCase() : undefined;

        if (cleanCode) {
            const [existing] = await db
                .select()
                .from(vouchers)
                .where(and(eq(vouchers.code, cleanCode), sql`${vouchers.id} != ${id}`))
                .limit(1);

            if (existing) {
                return res.status(400).json({ message: `Kode voucher "${cleanCode}" sudah digunakan` });
            }
        }

        const [updated] = await db
            .update(vouchers)
            .set({
                ...(cleanCode ? { code: cleanCode } : {}),
                ...(name !== undefined ? { name } : {}),
                ...(description !== undefined ? { description } : {}),
                ...(type !== undefined ? { type } : {}),
                ...(value !== undefined ? { value: String(value) } : {}),
                ...(minSpend !== undefined ? { minSpend: String(minSpend) } : {}),
                ...(maxDiscount !== undefined ? { maxDiscount: String(maxDiscount) } : {}),
                ...(quota !== undefined ? { quota: Number(quota) } : {}),
                ...(memberOnly !== undefined ? { memberOnly: Boolean(memberOnly) } : {}),
                ...(startDate ? { startDate: new Date(startDate) } : {}),
                ...(endDate ? { endDate: new Date(endDate) } : {}),
                ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
                updatedAt: new Date(),
            })
            .where(eq(vouchers.id, id))
            .returning();

        if (!updated) {
            return res.status(404).json({ message: "Voucher not found" });
        }

        logAction(req, {
            action: "update",
            table: "vouchers",
            data: updated,
            userId: req.user?.id,
            msg: `Voucher updated: ${updated.code}`,
        });

        res.status(200).json(updated);
    } catch (error: any) {
        console.error("Error updateVoucher:", error);
        res.status(500).json({ message: "Failed to update voucher", error: error.message });
    }
}

export async function deleteVoucher(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const [deleted] = await db
            .delete(vouchers)
            .where(eq(vouchers.id, id))
            .returning();

        if (!deleted) {
            return res.status(404).json({ message: "Voucher not found" });
        }

        logAction(req, {
            action: "delete",
            table: "vouchers",
            data: deleted,
            userId: req.user?.id,
            msg: `Voucher deleted: ${deleted.code}`,
        });

        res.status(200).json({ message: "Voucher berhasil dihapus", voucher: deleted });
    } catch (error: any) {
        console.error("Error deleteVoucher:", error);
        res.status(500).json({ message: "Failed to delete voucher", error: error.message });
    }
}

export async function validateVoucher(req: Request, res: Response) {
    try {
        const { code, subtotal, contactId } = req.body;
        const cleanCode = (code || "").trim().toUpperCase();

        if (!cleanCode) {
            return res.status(400).json({ valid: false, message: "Kode voucher tidak boleh kosong" });
        }

        const [voucher] = await db
            .select()
            .from(vouchers)
            .where(eq(vouchers.code, cleanCode))
            .limit(1);

        if (!voucher) {
            return res.status(200).json({ valid: false, message: "Kode voucher tidak ditemukan" });
        }

        if (!voucher.isActive) {
            return res.status(200).json({ valid: false, message: "Voucher ini sedang tidak aktif" });
        }

        const now = new Date();
        if (new Date(voucher.startDate) > now) {
            return res.status(200).json({
                valid: false,
                message: `Voucher baru berlaku mulai ${new Date(voucher.startDate).toLocaleDateString("id-ID")}`,
            });
        }

        if (new Date(voucher.endDate) < now) {
            return res.status(200).json({ valid: false, message: "Voucher sudah kedaluwarsa" });
        }

        if (voucher.quota > 0 && voucher.usedCount >= voucher.quota) {
            return res.status(200).json({ valid: false, message: "Kuota voucher sudah habis" });
        }

        const currentSubtotal = Number(subtotal || 0);
        const minSpend = Number(voucher.minSpend || 0);
        if (minSpend > 0 && currentSubtotal < minSpend) {
            return res.status(200).json({
                valid: false,
                message: `Minimal belanja Rp ${minSpend.toLocaleString("id-ID")} untuk menggunakan voucher ini`,
            });
        }

        if (voucher.memberOnly) {
            if (!contactId) {
                return res.status(200).json({
                    valid: false,
                    message: "Voucher ini khusus untuk Member terdaftar. Silakan pilih pelanggan member terlebih dahulu.",
                });
            }

            const [customer] = await db
                .select()
                .from(contacts)
                .where(eq(contacts.id, contactId))
                .limit(1);

            if (!customer || !customer.isMember) {
                return res.status(200).json({
                    valid: false,
                    message: "Pelanggan terpilih bukan member aktif. Voucher ini khusus Member.",
                });
            }
        }

        // Calculate discount
        let discountAmount = 0;
        if (voucher.type === "nominal") {
            discountAmount = Math.min(Number(voucher.value || 0), currentSubtotal);
        } else if (voucher.type === "percentage") {
            const rawDiscount = (currentSubtotal * Number(voucher.value || 0)) / 100;
            const maxDiscount = Number(voucher.maxDiscount || 0);
            discountAmount = maxDiscount > 0 ? Math.min(rawDiscount, maxDiscount) : rawDiscount;
            discountAmount = Math.min(discountAmount, currentSubtotal);
        }

        res.status(200).json({
            valid: true,
            voucher,
            discountAmount: Math.round(discountAmount),
            message: `Voucher ${voucher.name} berhasil diterapkan!`,
        });
    } catch (error: any) {
        console.error("Error validateVoucher:", error);
        res.status(500).json({ valid: false, message: "Gagal memvalidasi voucher", error: error.message });
    }
}

// ==========================================
// PROMOTIONS CONTROLLERS
// ==========================================

export async function getPaginatedPromotions(req: Request, res: Response) {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const pageSize = Math.max(1, Number(req.query.pageSize) || 10);
        const search = ((req.query.search as string) || "").trim();
        const type = (req.query.type as string) || "all";
        const status = (req.query.status as string) || "all";
        const offset = (page - 1) * pageSize;

        const conditions = [];

        if (search) {
            conditions.push(
                or(
                    ilike(promotions.name, `%${search}%`),
                    ilike(promotions.description, `%${search}%`)
                )
            );
        }

        if (type !== "all") {
            conditions.push(eq(promotions.type, type));
        }

        const now = new Date();
        if (status === "active") {
            conditions.push(
                and(
                    eq(promotions.isActive, true),
                    lte(promotions.startDate, now),
                    gte(promotions.endDate, now)
                )
            );
        } else if (status === "inactive") {
            conditions.push(eq(promotions.isActive, false));
        } else if (status === "expired") {
            conditions.push(sql`${promotions.endDate} < ${now}`);
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const [totalResult] = await db
            .select({ count: count() })
            .from(promotions)
            .where(whereClause);

        const total = totalResult?.count || 0;

        const items = await db
            .select()
            .from(promotions)
            .where(whereClause)
            .orderBy(desc(promotions.createdAt))
            .limit(pageSize)
            .offset(offset);

        // Enhance with product names if productId / buyProductId / getProductId / rules present
        const productIds = new Set<string>();
        const contactIds = new Set<string>();

        items.forEach((p) => {
            if (p.productId) productIds.add(p.productId);
            if (p.buyProductId) productIds.add(p.buyProductId);
            if (p.getProductId) productIds.add(p.getProductId);
            if (p.contactId) contactIds.add(p.contactId);
            if (Array.isArray(p.rules)) {
                p.rules.forEach((r: any) => {
                    if (r.productId) productIds.add(r.productId);
                });
            }
        });

        const productMap = new Map<string, string>();
        if (productIds.size > 0) {
            const matchedProducts = await db
                .select({ id: products.id, name: products.name })
                .from(products)
                .where(sql`${products.id} IN (${Array.from(productIds).map((id) => `'${id}'`).join(",")})`);
            matchedProducts.forEach((mp) => productMap.set(mp.id, mp.name));
        }

        const contactMap = new Map<string, string>();
        if (contactIds.size > 0) {
            const matchedContacts = await db
                .select({ id: contacts.id, name: contacts.name })
                .from(contacts)
                .where(sql`${contacts.id} IN (${Array.from(contactIds).map((id) => `'${id}'`).join(",")})`);
            matchedContacts.forEach((mc) => contactMap.set(mc.id, mc.name));
        }

        const enhancedItems = items.map((item) => {
            const enhancedRules = Array.isArray(item.rules)
                ? item.rules.map((r: any) => ({
                      ...r,
                      productName: r.productName || (r.productId && productMap.get(r.productId)) || null,
                  }))
                : [];

            return {
                ...item,
                rules: enhancedRules,
                contactName: item.contactId ? contactMap.get(item.contactId) || null : null,
                productName:
                    (item.productId && productMap.get(item.productId)) ||
                    (item.buyProductId && productMap.get(item.buyProductId)) ||
                    (enhancedRules.length > 0 ? enhancedRules.map((r) => r.productName || "Item").join(", ") : null),
                buyProductName: item.buyProductId ? productMap.get(item.buyProductId) || null : null,
                getProductName: item.getProductId ? productMap.get(item.getProductId) || null : null,
            };
        });

        res.status(200).json({
            items: enhancedItems,
            total,
            page,
            pageSize,
            totalPages: Math.ceil(total / pageSize),
        });
    } catch (error: any) {
        console.error("Error getPaginatedPromotions:", error);
        res.status(500).json({ message: "Failed to fetch promotions", error: error.message });
    }
}

export async function getActivePromotions(req: Request, res: Response) {
    try {
        const now = new Date();
        const activeList = await db
            .select()
            .from(promotions)
            .where(
                and(
                    eq(promotions.isActive, true),
                    lte(promotions.startDate, now),
                    gte(promotions.endDate, now)
                )
            )
            .orderBy(desc(promotions.createdAt));

        const productIds = new Set<string>();
        const contactIds = new Set<string>();

        activeList.forEach((p) => {
            if (p.productId) productIds.add(p.productId);
            if (p.buyProductId) productIds.add(p.buyProductId);
            if (p.getProductId) productIds.add(p.getProductId);
            if (p.contactId) contactIds.add(p.contactId);
            if (Array.isArray(p.rules)) {
                p.rules.forEach((r: any) => {
                    if (r.productId) productIds.add(r.productId);
                });
            }
        });

        const productMap = new Map<string, { id: string; name: string }>();
        if (productIds.size > 0) {
            const matchedProducts = await db
                .select({ id: products.id, name: products.name })
                .from(products)
                .where(sql`${products.id} IN (${Array.from(productIds).map((id) => `'${id}'`).join(",")})`);
            matchedProducts.forEach((mp) => productMap.set(mp.id, mp));
        }

        const contactMap = new Map<string, string>();
        if (contactIds.size > 0) {
            const matchedContacts = await db
                .select({ id: contacts.id, name: contacts.name })
                .from(contacts)
                .where(sql`${contacts.id} IN (${Array.from(contactIds).map((id) => `'${id}'`).join(",")})`);
            matchedContacts.forEach((mc) => contactMap.set(mc.id, mc.name));
        }

        const enhanced = activeList.map((item) => {
            const enhancedRules = Array.isArray(item.rules)
                ? item.rules.map((r: any) => ({
                      ...r,
                      productName: r.productName || (r.productId && productMap.get(r.productId)?.name) || null,
                  }))
                : [];

            return {
                ...item,
                rules: enhancedRules,
                contactName: item.contactId ? contactMap.get(item.contactId) || null : null,
                productName:
                    (item.productId && productMap.get(item.productId)?.name) ||
                    (item.buyProductId && productMap.get(item.buyProductId)?.name) ||
                    (enhancedRules.length > 0 ? enhancedRules.map((r) => r.productName || "Item").join(", ") : null),
                buyProductName: item.buyProductId ? productMap.get(item.buyProductId)?.name || null : null,
                getProductName: item.getProductId ? productMap.get(item.getProductId)?.name || null : null,
            };
        });

        res.status(200).json(enhanced);
    } catch (error: any) {
        console.error("Error getActivePromotions:", error);
        res.status(500).json({ message: "Failed to fetch active promotions", error: error.message });
    }
}

export async function getPromotionById(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const [promo] = await db
            .select()
            .from(promotions)
            .where(eq(promotions.id, id))
            .limit(1);

        if (!promo) {
            return res.status(404).json({ message: "Promotion not found" });
        }

        res.status(200).json(promo);
    } catch (error: any) {
        console.error("Error getPromotionById:", error);
        res.status(500).json({ message: "Failed to fetch promotion", error: error.message });
    }
}

export async function createPromotion(req: Request, res: Response) {
    try {
        const {
            name,
            description,
            type,
            discountPercent,
            discountAmount,
            minSpend,
            maxDiscount,
            productId,
            buyProductId,
            buyQty,
            getProductId,
            getQty,
            getDiscountPercent,
            memberTier,
            contactId,
            rules,
            branchId,
            startDate,
            endDate,
            isActive,
        } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ message: "Nama promosi wajib diisi" });
        }

        const sanitizedRules = Array.isArray(rules)
            ? rules.map((r: any) => ({
                  productId: r.productId,
                  productName: r.productName || null,
                  discountType: r.discountType || "percentage",
                  discountPercent: Number(r.discountPercent) || 0,
                  discountAmount: Number(r.discountAmount) || 0,
                  minQty: Number(r.minQty) || 1,
                  maxDiscount: Number(r.maxDiscount) || 0,
              }))
            : [];

        const effectiveProductId =
            productId ||
            buyProductId ||
            (sanitizedRules.length > 0 ? sanitizedRules[0].productId : null);

        const [created] = await db
            .insert(promotions)
            .values({
                name: name.trim(),
                description: description || null,
                type: type || "discount_percentage",
                discountPercent: String(discountPercent || 0),
                discountAmount: String(discountAmount || 0),
                minSpend: String(minSpend || 0),
                maxDiscount: String(maxDiscount || 0),
                productId: effectiveProductId,
                buyProductId: effectiveProductId,
                buyQty: Number(buyQty) || 1,
                getProductId: getProductId || null,
                getQty: Number(getQty) || 1,
                getDiscountPercent: String(getDiscountPercent !== undefined ? getDiscountPercent : 100),
                memberTier: memberTier || "all",
                contactId: contactId || null,
                rules: sanitizedRules,
                branchId: branchId || null,
                startDate: new Date(startDate || Date.now()),
                endDate: new Date(endDate || Date.now() + 30 * 24 * 60 * 60 * 1000),
                isActive: isActive !== undefined ? Boolean(isActive) : true,
            })
            .returning();

        logAction(req, {
            action: "insert",
            table: "promotions",
            data: created,
            userId: req.user?.id,
            msg: `Promotion created: ${created.name}`,
        });

        res.status(201).json(created);
    } catch (error: any) {
        console.error("Error createPromotion:", error);
        res.status(500).json({ message: "Failed to create promotion", error: error.message });
    }
}

export async function updatePromotion(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const {
            name,
            description,
            type,
            discountPercent,
            discountAmount,
            minSpend,
            maxDiscount,
            productId,
            buyProductId,
            buyQty,
            getProductId,
            getQty,
            getDiscountPercent,
            memberTier,
            contactId,
            rules,
            branchId,
            startDate,
            endDate,
            isActive,
        } = req.body;

        const sanitizedRules = rules !== undefined
            ? (Array.isArray(rules)
                  ? rules.map((r: any) => ({
                        productId: r.productId,
                        productName: r.productName || null,
                        discountType: r.discountType || "percentage",
                        discountPercent: Number(r.discountPercent) || 0,
                        discountAmount: Number(r.discountAmount) || 0,
                        minQty: Number(r.minQty) || 1,
                        maxDiscount: Number(r.maxDiscount) || 0,
                    }))
                  : [])
            : undefined;

        const effectiveProductId =
            productId !== undefined
                ? productId || null
                : buyProductId !== undefined
                  ? buyProductId || null
                  : sanitizedRules && sanitizedRules.length > 0
                    ? sanitizedRules[0].productId
                    : undefined;

        const [updated] = await db
            .update(promotions)
            .set({
                ...(name !== undefined ? { name: name.trim() } : {}),
                ...(description !== undefined ? { description } : {}),
                ...(type !== undefined ? { type } : {}),
                ...(discountPercent !== undefined ? { discountPercent: String(discountPercent) } : {}),
                ...(discountAmount !== undefined ? { discountAmount: String(discountAmount) } : {}),
                ...(minSpend !== undefined ? { minSpend: String(minSpend) } : {}),
                ...(maxDiscount !== undefined ? { maxDiscount: String(maxDiscount) } : {}),
                ...(effectiveProductId !== undefined ? { productId: effectiveProductId, buyProductId: effectiveProductId } : {}),
                ...(buyQty !== undefined ? { buyQty: Number(buyQty) } : {}),
                ...(getProductId !== undefined ? { getProductId: getProductId || null } : {}),
                ...(getQty !== undefined ? { getQty: Number(getQty) } : {}),
                ...(getDiscountPercent !== undefined ? { getDiscountPercent: String(getDiscountPercent) } : {}),
                ...(memberTier !== undefined ? { memberTier } : {}),
                ...(contactId !== undefined ? { contactId: contactId || null } : {}),
                ...(sanitizedRules !== undefined ? { rules: sanitizedRules } : {}),
                ...(branchId !== undefined ? { branchId: branchId || null } : {}),
                ...(startDate ? { startDate: new Date(startDate) } : {}),
                ...(endDate ? { endDate: new Date(endDate) } : {}),
                ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
                updatedAt: new Date(),
            })
            .where(eq(promotions.id, id))
            .returning();

        if (!updated) {
            return res.status(404).json({ message: "Promotion not found" });
        }

        logAction(req, {
            action: "update",
            table: "promotions",
            data: updated,
            userId: req.user?.id,
            msg: `Promotion updated: ${updated.name}`,
        });

        res.status(200).json(updated);
    } catch (error: any) {
        console.error("Error updatePromotion:", error);
        res.status(500).json({ message: "Failed to update promotion", error: error.message });
    }
}

export async function deletePromotion(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const [deleted] = await db
            .delete(promotions)
            .where(eq(promotions.id, id))
            .returning();

        if (!deleted) {
            return res.status(404).json({ message: "Promotion not found" });
        }

        logAction(req, {
            action: "delete",
            table: "promotions",
            data: deleted,
            userId: req.user?.id,
            msg: `Promotion deleted: ${deleted.name}`,
        });

        res.status(200).json({ message: "Promosi berhasil dihapus", promotion: deleted });
    } catch (error: any) {
        console.error("Error deletePromotion:", error);
        res.status(500).json({ message: "Failed to delete promotion", error: error.message });
    }
}

// ==========================================
// MEMBERS CONTROLLERS
// ==========================================

export async function getPaginatedMembers(req: Request, res: Response) {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const pageSize = Math.max(1, Number(req.query.pageSize) || 10);
        const search = ((req.query.search as string) || "").trim();
        const tier = (req.query.tier as string) || "all";
        const offset = (page - 1) * pageSize;

        const conditions: any[] = [
            eq(contacts.contactType, "customer"),
            eq(contacts.isMember, true),
        ];

        if (search) {
            conditions.push(
                or(
                    ilike(contacts.name, `%${search}%`),
                    ilike(contacts.phone, `%${search}%`),
                    ilike(contacts.memberCode, `%${search}%`),
                    ilike(contacts.email, `%${search}%`)
                )!
            );
        }

        if (tier !== "all") {
            conditions.push(eq(contacts.memberTier, tier));
        }

        const whereClause = and(...conditions)!;

        const [totalResult] = await db
            .select({ count: count() })
            .from(contacts)
            .where(whereClause);

        const total = totalResult?.count || 0;

        const items = await db
            .select({
                id: contacts.id,
                name: contacts.name,
                phone: contacts.phone,
                email: contacts.email,
                address: contacts.address,
                contactType: contacts.contactType,
                isMember: contacts.isMember,
                memberCode: contacts.memberCode,
                memberTier: contacts.memberTier,
                points: contacts.points,
                birthDate: contacts.birthDate,
                priceGroupId: contacts.priceGroupId,
                priceGroupName: priceGroups.name,
                createdAt: contacts.createdAt,
                updatedAt: contacts.updatedAt,
            })
            .from(contacts)
            .leftJoin(priceGroups, eq(contacts.priceGroupId, priceGroups.id))
            .where(whereClause)
            .orderBy(desc(contacts.updatedAt))
            .limit(pageSize)
            .offset(offset);

        res.status(200).json({
            items,
            total,
            page,
            pageSize,
            totalPages: Math.ceil(total / pageSize),
        });
    } catch (error: any) {
        console.error("Error getPaginatedMembers:", error);
        res.status(500).json({ message: "Failed to fetch members", error: error.message });
    }
}

export async function getMemberSummary(req: Request, res: Response) {
    try {
        const membersList = await db
            .select({
                tier: contacts.memberTier,
                points: contacts.points,
            })
            .from(contacts)
            .where(and(eq(contacts.contactType, "customer"), eq(contacts.isMember, true)));

        const totalMembers = membersList.length;
        let silverCount = 0;
        let goldCount = 0;
        let platinumCount = 0;
        let standardCount = 0;
        let totalPoints = 0;

        for (const m of membersList) {
            totalPoints += Number(m.points || 0);
            const t = (m.tier || "standard").toLowerCase();
            if (t === "platinum") platinumCount++;
            else if (t === "gold") goldCount++;
            else if (t === "silver") silverCount++;
            else standardCount++;
        }

        res.status(200).json({
            totalMembers,
            standardCount,
            silverCount,
            goldCount,
            platinumCount,
            totalPoints,
        });
    } catch (error: any) {
        console.error("Error getMemberSummary:", error);
        res.status(500).json({ message: "Failed to fetch member summary", error: error.message });
    }
}

export async function registerMember(req: Request, res: Response) {
    try {
        const { contactId, name, phone, email, address, memberCode, memberTier, birthDate, priceGroupId } = req.body;

        const now = new Date();
        const codeSuffix = Math.floor(1000 + Math.random() * 9000);
        const autoCode = `MBR-${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, "0")}-${codeSuffix}`;
        const finalCode = (memberCode || autoCode).trim().toUpperCase();

        const formattedBirthDate = birthDate
            ? (typeof birthDate === "string" ? birthDate.split("T")[0] : new Date(birthDate).toISOString().split("T")[0])
            : null;

        // Resolve priceGroupId: user-provided or auto-fallback to "Regular" / first active price group
        let resolvedPriceGroupId = priceGroupId || null;
        if (!resolvedPriceGroupId) {
            const [regularPg] = await db
                .select({ id: priceGroups.id })
                .from(priceGroups)
                .where(or(ilike(priceGroups.name, "%regular%"), ilike(priceGroups.name, "%umum%")))
                .limit(1);
            if (regularPg) {
                resolvedPriceGroupId = regularPg.id;
            } else {
                const [firstPg] = await db
                    .select({ id: priceGroups.id })
                    .from(priceGroups)
                    .limit(1);
                resolvedPriceGroupId = firstPg?.id || null;
            }
        }

        // Check code uniqueness
        const [codeExists] = await db
            .select()
            .from(contacts)
            .where(
                contactId
                    ? and(eq(contacts.memberCode, finalCode), sql`${contacts.id} != ${contactId}`)
                    : eq(contacts.memberCode, finalCode)
            )
            .limit(1);

        if (codeExists) {
            return res.status(400).json({ message: `Nomor kartu member "${finalCode}" sudah digunakan` });
        }

        let savedContact;

        if (contactId) {
            // Upgrade existing customer to member
            const [updated] = await db
                .update(contacts)
                .set({
                    isMember: true,
                    memberCode: finalCode,
                    memberTier: memberTier || "standard",
                    birthDate: formattedBirthDate,
                    ...(resolvedPriceGroupId ? { priceGroupId: resolvedPriceGroupId } : {}),
                    updatedAt: new Date(),
                })
                .where(eq(contacts.id, contactId))
                .returning();
            savedContact = updated;
        } else {
            // Create new customer and mark as member
            if (!name) {
                return res.status(400).json({ message: "Nama pelanggan wajib diisi" });
            }

            const [created] = await db
                .insert(contacts)
                .values({
                    name: name.trim(),
                    address: address || "-",
                    phone: phone || "-",
                    email: email || "-",
                    contactType: "customer",
                    isMember: true,
                    memberCode: finalCode,
                    memberTier: memberTier || "standard",
                    birthDate: formattedBirthDate,
                    priceGroupId: resolvedPriceGroupId,
                    points: 0,
                })
                .returning();
            savedContact = created;
        }

        logAction(req, {
            action: "insert",
            table: "contacts",
            data: savedContact,
            userId: req.user?.id,
            msg: `Customer registered as member: ${savedContact?.name} (${finalCode})`,
        });

        await Promise.all([
            CacheService.del("customers:all"),
            CacheService.del("customers:active"),
        ]).catch(() => {});

        res.status(200).json(savedContact);
    } catch (error: any) {
        console.error("Error registerMember:", error);
        res.status(500).json({ message: "Failed to register member", error: error.message });
    }
}

export async function updateMember(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const { memberCode, memberTier, points, birthDate, isMember, priceGroupId } = req.body;

        const formattedBirthDate = birthDate !== undefined
            ? (birthDate ? (typeof birthDate === "string" ? birthDate.split("T")[0] : new Date(birthDate).toISOString().split("T")[0]) : null)
            : undefined;

        const [updated] = await db
            .update(contacts)
            .set({
                ...(memberCode !== undefined ? { memberCode: memberCode.trim().toUpperCase() } : {}),
                ...(memberTier !== undefined ? { memberTier } : {}),
                ...(points !== undefined ? { points: Number(points) } : {}),
                ...(formattedBirthDate !== undefined ? { birthDate: formattedBirthDate } : {}),
                ...(isMember !== undefined ? { isMember: Boolean(isMember) } : {}),
                ...(priceGroupId !== undefined ? { priceGroupId: priceGroupId || null } : {}),
                updatedAt: new Date(),
            })
            .where(eq(contacts.id, id))
            .returning();

        if (!updated) {
            return res.status(404).json({ message: "Member not found" });
        }

        await Promise.all([
            CacheService.del("customers:all"),
            CacheService.del("customers:active"),
        ]).catch(() => {});

        res.status(200).json(updated);
    } catch (error: any) {
        console.error("Error updateMember:", error);
        res.status(500).json({ message: "Failed to update member", error: error.message });
    }
}

export async function adjustMemberPoints(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const { pointsDelta, reason } = req.body;
        const delta = Number(pointsDelta) || 0;

        if (delta === 0) {
            return res.status(400).json({ message: "Jumlah penyesuaian poin tidak boleh 0" });
        }

        const [member] = await db
            .select()
            .from(contacts)
            .where(eq(contacts.id, id))
            .limit(1);

        if (!member) {
            return res.status(404).json({ message: "Member not found" });
        }

        const currentPoints = Number(member.points || 0);
        const newPoints = Math.max(0, currentPoints + delta);

        const [updated] = await db
            .update(contacts)
            .set({
                points: newPoints,
                updatedAt: new Date(),
            })
            .where(eq(contacts.id, id))
            .returning();

        logAction(req, {
            action: "update",
            table: "contacts",
            data: { id, pointsDelta: delta, newPoints, reason },
            userId: req.user?.id,
            msg: `Adjusted points for ${member.name}: ${delta > 0 ? "+" : ""}${delta} (Reason: ${reason || "Manual Adjustment"})`,
        });

        res.status(200).json(updated);
    } catch (error: any) {
        console.error("Error adjustMemberPoints:", error);
        res.status(500).json({ message: "Failed to adjust member points", error: error.message });
    }
}
