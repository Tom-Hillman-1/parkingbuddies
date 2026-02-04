import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export type AuthRequest = Request & { userId?: string };

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
        return res.status(401).json({ ok: false, error: "Missing Bearer token" });
    }

    const token = header.slice("Bearer ".length).trim();
    const secret = process.env.JWT_SECRET;

    if (!secret) {
        return res.status(500).json({ ok: false, error: "JWT_SECRET not configured" });
    }

    try {
        const payload = jwt.verify(token, secret) as { userId: string };
        req.userId = payload.userId;
        next();
    } catch {
        return res.status(401).json({ ok: false, error: "Invalid or expired token" });
    }
}