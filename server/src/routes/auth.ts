import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../db";
import {
    isValidEmail,
    isValidName,
    isValidPassword,
    normalizeEmail,
    normalizeName,
} from "../lib/shared";

const router = Router();
const SIGNUP_REWARD_POINTS = 1;

function issueToken(userId: string) {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("JWT_SECRET not configured");

    return jwt.sign({ userId }, secret, { expiresIn: "7d" });
}

router.post("/signup", async (req, res) => {
    const { email, name, password } = req.body ?? {};

    if (typeof email !== "string" || typeof name !== "string" || typeof password !== "string") {
        return res.status(400).json({ ok: false, error: "email, name, password are required" });
    }

    const trimmedEmail = normalizeEmail(email);
    const trimmedName = normalizeName(name);

    if (!isValidEmail(trimmedEmail)) {
        return res.status(400).json({ ok: false, error: "Invalid email format" });
    }

    if (!isValidName(trimmedName)) {
        return res.status(400).json({ ok: false, error: "Name must be 2-120 characters" });
    }

    if (!isValidPassword(password)) {
        return res.status(400).json({
            ok: false,
            error: "Password must be at least 8 characters and include at least 1 letter and 1 number",
        });
    }

    try {
        const existing = await pool.query("SELECT id FROM users WHERE email = $1", [trimmedEmail]);
        if (existing.rowCount && existing.rowCount > 0) {
            return res.status(409).json({ ok: false, error: "Email already in use" });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const created = await client.query(
                `INSERT INTO users (email, name, password_hash, points_balance)
                 VALUES ($1, $2, $3, $4)
                 RETURNING id, email, name, points_balance, created_at`,
                [trimmedEmail, trimmedName, passwordHash, SIGNUP_REWARD_POINTS]
            );

            const user = created.rows[0];
            await client.query(
                `INSERT INTO reward_transactions (user_id, type, amount, reason)
                 VALUES ($1, 'earn', $2, 'account_signup')`,
                [user.id, SIGNUP_REWARD_POINTS]
            );

            await client.query("COMMIT");
            const token = issueToken(user.id);
            return res.status(201).json({ ok: true, token, user });
        } catch (e: any) {
            await client.query("ROLLBACK");
            if (String(e?.code) === "23505") {
                return res.status(409).json({ ok: false, error: "Email already in use" });
            }
            throw e;
        } finally {
            client.release();
        }
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

router.post("/login", async (req, res) => {
    const { email, password } = req.body ?? {};

    if (typeof email !== "string" || typeof password !== "string") {
        return res.status(400).json({ ok: false, error: "email and password are required" });
    }

    const trimmedEmail = normalizeEmail(email);

    try {
        const r = await pool.query(
            `SELECT id, email, name, password_hash, points_balance, created_at
       FROM users
       WHERE email = $1`,
            [trimmedEmail]
        );

        if (!r.rowCount) {
            return res.status(401).json({ ok: false, error: "Invalid email or password" });
        }

        const user = r.rows[0];
        const ok = await bcrypt.compare(password, user.password_hash);

        if (!ok) {
            return res.status(401).json({ ok: false, error: "Invalid email or password" });
        }

        const token = issueToken(user.id);

        const safeUser = {
            id: user.id,
            email: user.email,
            name: user.name,
            points_balance: Math.max(0, Number(user.points_balance ?? 0)),
            created_at: user.created_at,
        };

        return res.json({ ok: true, token, user: safeUser });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

export default router;
