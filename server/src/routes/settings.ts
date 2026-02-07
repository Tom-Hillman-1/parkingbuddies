import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db";
import { requireAuth, AuthRequest } from "../middleware/auth";

const router = Router();

function isValidEmail(email: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// same password rule as signup (PDD “advanced” requirement)
function isValidPassword(pw: string) {
    if (pw.length < 8) return false;
    const hasLetter = /[A-Za-z]/.test(pw);
    const hasNumber = /[0-9]/.test(pw);
    return hasLetter && hasNumber;
}

/**
 * PATCH /settings/profile
 * Body can include: { name?: string, email?: string }
 */
router.patch("/profile", requireAuth, async (req: AuthRequest, res) => {
    const { name, email } = req.body ?? {};

    const updates: string[] = [];
    const values: any[] = [];
    let i = 1;

    if (name !== undefined) {
        if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 120) {
            return res.status(400).json({ ok: false, error: "Name must be 2–120 characters" });
        }
        updates.push(`name = $${i++}`);
        values.push(name.trim());
    }

    if (email !== undefined) {
        if (typeof email !== "string" || !isValidEmail(email.trim().toLowerCase())) {
            return res.status(400).json({ ok: false, error: "Invalid email format" });
        }
        updates.push(`email = $${i++}`);
        values.push(email.trim().toLowerCase());
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

        return res.json({ ok: true, user: r.rows[0] });
    } catch (e) {
        // common case: duplicate email violates unique constraint
        if (String(e).includes("duplicate key value") || String(e).includes("users_email_key")) {
            return res.status(409).json({ ok: false, error: "Email already in use" });
        }
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

/**
 * PATCH /settings/password
 * Body: { currentPassword: string, newPassword: string }
 */
router.patch("/password", requireAuth, async (req: AuthRequest, res) => {
    const { currentPassword, newPassword } = req.body ?? {};

    if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
        return res.status(400).json({ ok: false, error: "currentPassword and newPassword are required" });
    }

    if (!isValidPassword(newPassword)) {
        return res.status(400).json({
            ok: false,
            error: "New password must be at least 8 characters and include at least 1 letter and 1 number",
        });
    }

    try {
        const r = await pool.query(
            `SELECT id, password_hash FROM users WHERE id = $1`,
            [req.userId]
        );

        if (!r.rowCount) {
            return res.status(404).json({ ok: false, error: "User not found" });
        }

        const ok = await bcrypt.compare(currentPassword, r.rows[0].password_hash);
        if (!ok) {
            return res.status(401).json({ ok: false, error: "Current password is incorrect" });
        }

        const newHash = await bcrypt.hash(newPassword, 10);

        await pool.query(
            `UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2`,
            [newHash, req.userId]
        );

        return res.json({ ok: true });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

export default router;
