import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { pool } from "../db";
import {
    isValidEmail,
    isValidName,
    isValidPassword,
    normalizeEmail,
    normalizeName,
    PASSWORD_REQUIREMENTS_TEXT,
    SIGNUP_REWARD_POINTS,
} from "../lib/shared";
import { parseWithSchema } from "../lib/validation";
import { serverError } from "../lib/errors";
import { simpleRateLimit } from "../lib/rateLimit";
import { issueAuthToken } from "../lib/tokens";

const router = Router();
const signupBodySchema = z.object({
    email: z.string(),
    name: z.string(),
    password: z.string(),
});

const loginBodySchema = z.object({
    email: z.string(),
    password: z.string(),
    remember: z.boolean().optional(),
});

const signupRateLimit = simpleRateLimit({
    windowMs: 60 * 60 * 1000,
    max: 6,
    message: "Too many account creation attempts. Please try again later.",
    keyPrefix: "auth_signup",
});

const loginRateLimit = simpleRateLimit({
    windowMs: 10 * 60 * 1000,
    max: 10,
    message: "Too many login attempts. Please try again shortly.",
    keyPrefix: "auth_login",
});

router.post("/signup", signupRateLimit, async (req, res) => {
    const parsedBody = parseWithSchema(signupBodySchema, req.body ?? {}, res, "signup");
    if (!parsedBody.ok) return;
    const { email, name, password } = parsedBody.data;

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
            error: PASSWORD_REQUIREMENTS_TEXT,
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
                 RETURNING id, email, name, points_balance, created_at, token_version`,
                [trimmedEmail, trimmedName, passwordHash, SIGNUP_REWARD_POINTS]
            );

            const user = created.rows[0];
            await client.query(
                `INSERT INTO reward_transactions (user_id, type, amount, reason)
                 VALUES ($1, 'earn', $2, 'account_signup')`,
                [user.id, SIGNUP_REWARD_POINTS]
            );

            await client.query("COMMIT");
            const token = issueAuthToken(user.id, Number(user.token_version ?? 0));
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
        return serverError(res, e, "Unable to create account right now");
    }
});

router.post("/login", loginRateLimit, async (req, res) => {
    const parsedBody = parseWithSchema(loginBodySchema, req.body ?? {}, res, "login");
    if (!parsedBody.ok) return;
    const { email, password, remember = false } = parsedBody.data;

    const trimmedEmail = normalizeEmail(email);

    try {
        const r = await pool.query(
            `SELECT id, email, name, password_hash, points_balance, created_at, token_version
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

        const token = issueAuthToken(user.id, Number(user.token_version ?? 0), remember);

        const safeUser = {
            id: user.id,
            email: user.email,
            name: user.name,
            points_balance: Math.max(0, Number(user.points_balance ?? 0)),
            created_at: user.created_at,
        };

        return res.json({ ok: true, token, user: safeUser });
    } catch (e) {
        return serverError(res, e, "Unable to log in right now");
    }
});

export default router;
