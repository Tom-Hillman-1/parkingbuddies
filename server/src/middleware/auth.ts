import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { pool } from "../db";
import { serverError } from "../lib/errors";

export type AuthRequest = Request & { userId?: string };

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
        return res.status(401).json({ ok: false, error: "Missing Bearer token" });
    }

    const token = header.slice("Bearer ".length).trim();
    const secret = process.env.JWT_SECRET;

    if (!secret) {
        return serverError(res, new Error("JWT_SECRET not configured"));
    }

    try {
        const payload = jwt.verify(token, secret) as { userId: string; tokenVersion?: number };
        if (!payload?.userId || typeof payload.tokenVersion !== "number") {
            return res.status(401).json({ ok: false, error: "Invalid or expired token" });
        }

        const userR = await pool.query(`SELECT token_version FROM users WHERE id = $1`, [payload.userId]);
        if (!userR.rowCount) {
            return res.status(401).json({ ok: false, error: "Invalid or expired token" });
        }
        const currentTokenVersion = Number(userR.rows[0]?.token_version ?? -1);
        if (currentTokenVersion !== payload.tokenVersion) {
            return res.status(401).json({ ok: false, error: "Invalid or expired token" });
        }

        req.userId = payload.userId;
        return next();
    } catch (error) {
        if (error instanceof Error && error.message === "Invalid or expired token") {
            return res.status(401).json({ ok: false, error: "Invalid or expired token" });
        }
        return res.status(401).json({ ok: false, error: "Invalid or expired token" });
    }
}
