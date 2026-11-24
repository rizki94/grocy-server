import { tenantStorage } from "@/services/tenant.service";

type CacheEntry = {
    value: string;
    expiry: number;
};

const cache = new Map<string, CacheEntry>();

export class CacheService {
    private static getScopedKey(key: string): string {
        const tenantDb = tenantStorage.getStore()?.dbName || "default";
        return `${tenantDb}:${key}`;
    }

    static async get<T>(key: string): Promise<T | null> {
        const scopedKey = this.getScopedKey(key);
        const entry = cache.get(scopedKey);
        if (!entry) return null;

        if (Date.now() > entry.expiry) {
            cache.delete(scopedKey);
            return null;
        }

        return JSON.parse(entry.value) as T;
    }

    static async set<T>(key: string, value: T, ttlSeconds = 60): Promise<void> {
        const scopedKey = this.getScopedKey(key);
        const expiry = Date.now() + ttlSeconds * 1000;
        cache.set(scopedKey, { value: JSON.stringify(value), expiry });
    }

    static async del(key: string): Promise<void> {
        const scopedKey = this.getScopedKey(key);
        cache.delete(scopedKey);
    }

    static async delByPrefix(prefix: string): Promise<void> {
        const tenantDb = tenantStorage.getStore()?.dbName || "default";
        const scopedPrefix = `${tenantDb}:${prefix}`;
        for (const k of cache.keys()) {
            if (k.startsWith(scopedPrefix)) {
                cache.delete(k);
            }
        }
    }

    static async clearTenant(dbName?: string): Promise<void> {
        const tenantDb = dbName || tenantStorage.getStore()?.dbName || "default";
        const prefix = `${tenantDb}:`;
        for (const k of cache.keys()) {
            if (k.startsWith(prefix)) {
                cache.delete(k);
            }
        }
    }

    static async getOrSet<T>(
        key: string,
        ttlSeconds: number,
        fetchFn: () => Promise<T>
    ): Promise<T> {
        const cached = await this.get<T>(key);
        if (cached) return cached;

        const fresh = await fetchFn();
        await this.set(key, fresh, ttlSeconds);
        return fresh;
    }
}
