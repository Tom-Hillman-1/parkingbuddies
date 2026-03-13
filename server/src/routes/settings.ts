import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { pool } from "../db";
import { requireAuth, AuthRequest } from "../middleware/auth";
import {
    isValidEmail,
    isValidName,
    isValidPassword,
    normalizeEmail,
    normalizeName,
} from "../lib/shared";
import { parseWithSchema } from "../lib/validation";

const router = Router();
const profileBodySchema = z.object({
    name: z.string().optional(),
    email: z.string().optional(),
});

const passwordBodySchema = z.object({
    currentPassword: z.string(),
    newPassword: z.string(),
});

router.get("/", requireAuth, async (req: AuthRequest, res) => {
    try {
        const r = await pool.query(
            `SELECT name, email
             FROM users
             WHERE id = $1`,
            [req.userId]
        );
        if (!r.rowCount) {
            return res.status(404).json({ ok: false, error: "User not found" });
        }
        return res.json({ ok: true, settings: r.rows[0] });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

router.patch("/profile", requireAuth, async (req: AuthRequest, res) => {
    const parsedBody = parseWithSchema(profileBodySchema, req.body ?? {}, res, "settings_profile");
    if (!parsedBody.ok) return;
    const { name, email } = parsedBody.data;

    const updates: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (name !== undefined) {
        if (typeof name !== "string" || !isValidName(normalizeName(name))) {
            return res.status(400).json({ ok: false, error: "Name must be 2-120 characters" });
        }
        updates.push(`name = $${i++}`);
        values.push(normalizeName(name));
    }

    if (email !== undefined) {
        if (typeof email !== "string" || !isValidEmail(normalizeEmail(email))) {
            return res.status(400).json({ ok: false, error: "Invalid email format" });
        }
        updates.push(`email = $${i++}`);
        values.push(normalizeEmail(email));
    }

    if (updates.length === 0) {
        return res.status(400).json({ ok: false, error: "No fields to update" });
    }

    values.push(req.userId);

    try {
        const r = await pool.query(
            `UPDATE users
       SET ${updates.join(", ")}, updated_at = now()
       WHERE id = $${i}
       RETURNING id,
                 email,
                 name,
                 points_balance,
                 stripe_account_id,
                 stripe_charges_enabled,
                 stripe_payouts_enabled,
                 stripe_details_submitted,
                 created_at,
                 updated_at`,
            values
        );

        if (!r.rowCount) {
            return res.status(404).json({ ok: false, error: "User not found" });
        }

        return res.json({ ok: true, user: r.rows[0] });
    } catch (e) {
        if (String(e).includes("duplicate key value") || String(e).includes("users_email_key")) {
            return res.status(409).json({ ok: false, error: "Email already in use" });
        }
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

router.patch("/password", requireAuth, async (req: AuthRequest, res) => {
    const parsedBody = parseWithSchema(passwordBodySchema, req.body ?? {}, res, "settings_password");
    if (!parsedBody.ok) return;
    const { currentPassword, newPassword } = parsedBody.data;

    if (!currentPassword.trim() || !newPassword.trim()) {
        return res.status(400).json({ ok: false, error: "currentPassword and newPassword are required" });
    }

    if (!isValidPassword(newPassword)) {
        return res.status(400).json({
            ok: false,
            error: "New password must be at least 8 characters and include at least 1 letter and 1 number",
        });
    }

    try {
        const r = await pool.query(`SELECT id, password_hash FROM users WHERE id = $1`, [req.userId]);

        if (!r.rowCount) {
            return res.status(404).json({ ok: false, error: "User not found" });
        }

        const ok = await bcrypt.compare(currentPassword, r.rows[0].password_hash);
        if (!ok) {
            return res.status(401).json({ ok: false, error: "Current password is incorrect" });
        }
        const isSamePassword = await bcrypt.compare(newPassword, r.rows[0].password_hash);
        if (isSamePassword) {
            return res.status(400).json({ ok: false, error: "New password must be different from current password" });
        }

        const newHash = await bcrypt.hash(newPassword, 10);

        await pool.query(`UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2`, [newHash, req.userId]);

        return res.json({ ok: true });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

export default router;
