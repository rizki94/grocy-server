export interface SessionMeta {
    userId: string;
    username: string;
    ip: string;
    userAgent: string;
    loginAt: string;
    lastActivityAt: string;
}

/**
 * Formats a compact browser + OS summary from a User-Agent header string.
 */
export function parseUserAgentHint(ua?: string | null): string {
    if (!ua || ua === "unknown") return "Unknown Device";

    let browser = "Browser";
    if (ua.includes("Edg/")) browser = "Edge";
    else if (ua.includes("OPR/") || ua.includes("Opera")) browser = "Opera";
    else if (ua.includes("Chrome/") && !ua.includes("Edg/")) browser = "Chrome";
    else if (ua.includes("Firefox/")) browser = "Firefox";
    else if (ua.includes("Safari/") && !ua.includes("Chrome/")) browser = "Safari";

    let os = "Unknown OS";
    if (ua.includes("Windows")) os = "Windows";
    else if (ua.includes("Android")) os = "Android";
    else if (ua.includes("iPhone") || ua.includes("iPad")) os = "iOS";
    else if (ua.includes("Mac OS X")) os = "macOS";
    else if (ua.includes("Linux")) os = "Linux";

    return `${browser} on ${os}`;
}

/**
 * Resolves the client IP address taking reverse proxy headers into account.
 */
export function getClientIp(req: { ip?: string; headers?: Record<string, any> }): string {
    const forwarded = req.headers?.["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.length > 0) {
        return forwarded.split(",")[0].trim();
    }
    return req.ip || "unknown";
}

