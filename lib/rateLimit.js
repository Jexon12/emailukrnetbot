/**
 * In-memory rate limiter.
 * Limits: API requests per minute, Telegram commands per user per minute.
 */
const limits = new Map(); // key -> { count, resetAt }

function check(key, maxPerMinute = 60) {
    const now = Date.now();
    const windowMs = 60 * 1000;
    let entry = limits.get(key);
    if (!entry || now > entry.resetAt) {
        entry = { count: 0, resetAt: now + windowMs };
        limits.set(key, entry);
    }
    entry.count++;
    if (entry.count > maxPerMinute) {
        return false;
    }
    return true;
}

function middleware(maxPerMinute = 100) {
    return (req, res, next) => {
        const key = req.ip || req.socket?.remoteAddress || 'unknown';
        if (!check(key, maxPerMinute)) {
            return res.status(429).json({ error: 'Too many requests' });
        }
        next();
    };
}

module.exports = { check, middleware };

// Periodically remove expired entries to prevent memory leak
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of limits) {
        if (now > entry.resetAt) limits.delete(key);
    }
}, 60000);
