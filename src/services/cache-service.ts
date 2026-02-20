type CacheEntry = {
    value: string;
    expiry: number;
};

const cache = new Map<string, CacheEntry>();

export class CacheService {
    static async get<T>(key: string): Promise<T | null> {
        const entry = cache.get(key);
        if (!entry) return null;

        if (Date.now() > entry.expiry) {
            cache.delete(key);
            return null;
        }

        return JSON.parse(entry.value) as T;
    }

    static async set<T>(key: string, value: T, ttlSeconds = 60): Promise<void> {
        const expiry = Date.now() + ttlSeconds * 1000;
        cache.set(key, { value: JSON.stringify(value), expiry });
    }

    static async del(key: string): Promise<void> {
        cache.delete(key);
    }

    static async delByPrefix(prefix: string): Promise<void> {
        // Original implementation looked for `cache:${prefix}*`
        // Since we are moving to in-memory and want to keep behavior consistent (or fix it),
        // we'll search for keys starting with the prefix.
        // If the original intent was `cache:` namespace, we might need to adjust,
        // but based on usage seen, strict prefix matching on the key itself is likely what's needed or at least safe.
        // Using strict prefix matching on the key:
        for (const key of cache.keys()) {
            if (key.startsWith(prefix)) {
                cache.delete(key);
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
