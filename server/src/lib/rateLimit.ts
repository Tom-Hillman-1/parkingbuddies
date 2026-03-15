import type { Request, Response, NextFunction } from "express";

type RateLimitOptions = {
    windowMs: number;
    max: number;
    message: string;
    keyPrefix: string;
};

type RateLimitEntry = {
    count: number;
    resetAt: number;
};

const buckets = new Map<string, RateLimitEntry>();

export function simpleRateLimit(options: RateLimitOptions) {
    const { windowMs, max, message, keyPrefix } = options;

    return (req: Request, res: Response, next: NextFunction) => {
        const now = Date.now();
        if (buckets.size > 1000) {
            for (const [bucketKey, entry] of buckets.entries()) {
                if (entry.resetAt <= now) {
                    buckets.delete(bucketKey);
                }
            }
        }
        const key = `${keyPrefix}:${req.ip ?? "unknown"}`;
        const current = buckets.get(key);

        if (!current || current.resetAt <= now) {
            buckets.set(key, { count: 1, resetAt: now + windowMs });
            return next();
        }

        if (current.count >= max) {
            const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
            res.setHeader("Retry-After", String(retryAfterSeconds));
            return res.status(429).json({ ok: false, error: message });
        }

        current.count += 1;
        buckets.set(key, current);
        return next();
    };
}
