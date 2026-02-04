import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../db";

const router = Router();

// simple validators (enough for PDD)
function isValidEmail(email: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// "advanced" requirement: min 8 chars, at least 1 letter and 1 number
function isValidPassword(pw: string) {
    if (pw.length < 8) return false;
    const hasLetter = /[A-Za-z]/.test(pw);
    const hasNumber = /[0-9]/.test(pw);
    return hasLetter && hasNumber;
}

function issueToken(userId: string) {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("JWT_SECRET not configured");

    return jwt.sign({ userId }, secret, { expiresIn: "7d" });
}

// POST /auth/signup
router.post("/signup", async (req, res) => {
    const { email, name, password } = req.body ?? {};

    if (typeof email !== "string" || typeof name !== "string" || typeof password !== "string") {
        return res.status(400).json({ ok: false, error: "email, name, password are required" });
    }

    const trimmedEmail = email.trim().toLowerCase();
    const trimmedName = name.trim();

    if (!isValidEmail(trimmedEmail)) {
        return res.status(400).json({ ok: false, error: "Invalid email format" });
    }

    if (trimmedName.length < 2 || trimmedName.length > 120) {
        return res.status(400).json({ ok: false, error: "Name must be 2–120 characters" });
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

        const created = await pool.query(
            `INSERT INTO users (email, name, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, email, name, points_balance, created_at`,
            [trimmedEmail, trimmedName, passwordHash]
        );

        const user = created.rows[0];
        const token = issueToken(user.id);

        return res.status(201).json({ ok: true, token, user });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

// POST /auth/login
router.post("/login", async (req, res) => {
    const { email, password } = req.body ?? {};

    if (typeof email !== "string" || typeof password !== "string") {
        return res.status(400).json({ ok: false, error: "email and password are required" });
    }

    const trimmedEmail = email.trim().toLowerCase();

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

        // never send password_hash back
        const safeUser = {
            id: user.id,
            email: user.email,
            name: user.name,
            points_balance: user.points_balance,
            created_at: user.created_at,
        };

        return res.json({ ok: true, token, user: safeUser });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

export default router;