import rateLimit from "express-rate-limit";

// Limit login attempts to protect against brute-force attacks
export const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Max 10 attempts per IP per window
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        message: "Too many login attempts from this IP. Please wait 15 minutes before trying again.",
    },
});

// General API protection rate limiter (allows normal user traffic)
export const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 300, // Max 300 requests per minute
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        message: "Too many requests. Please slow down.",
    },
});

