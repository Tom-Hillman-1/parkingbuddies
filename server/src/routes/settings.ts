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
    PASSWORD_REQUIREMENTS_TEXT,
    PROFILE_COMPLETION_REWARD_POINTS,
} from "../lib/shared";
import { parseWithSchema } from "../lib/validation";
import { serverError } from "../lib/errors";
import { simpleRateLimit } from "../lib/rateLimit";
import { issueAuthToken } from "../lib/tokens";

const router = Router();
const profileBodySchema = z.object({
    name: z.string().optional(),
    email: z.string().optional(),
});

const passwordBodySchema = z.object({
    currentPassword: z.string(),
    newPassword: z.string(),
});
const profileUpdateRateLimit = simpleRateLimit({
    windowMs: 60 * 60 * 1000,
    max: 12,
    message: "Too many profile updates. Please wait a bit and try again.",
    keyPrefix: "settings_profile",
});
const passwordUpdateRateLimit = simpleRateLimit({
    windowMs: 60 * 60 * 1000,
    max: 6,
    message: "Too many password changes. Please wait a bit and try again.",
    keyPrefix: "settings_password",
});
const deleteAccountRateLimit = simpleRateLimit({
    windowMs: 60 * 60 * 1000,
    max: 2,
    message: "Too many account deletion attempts. Please wait a bit and try again.",
    keyPrefix: "settings_delete_account",
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
        return serverError(res, e, "Unable to load settings right now");
    }
});

router.patch("/profile", requireAuth, profileUpdateRateLimit, async (req: AuthRequest, res) => {
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

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const currentUserR = await client.query(
            `SELECT name, email
             FROM users
             WHERE id = $1
             FOR UPDATE`,
            [req.userId]
        );
        if (!currentUserR.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ ok: false, error: "User not found" });
        }

        const currentUser = currentUserR.rows[0];
        const nextName = name !== undefined ? normalizeName(name) : currentUser.name;
        const nextEmail = email !== undefined ? normalizeEmail(email) : currentUser.email;
        const profileCompleteBeforeUpdate =
            isValidName(normalizeName(currentUser.name ?? "")) &&
            isValidEmail(normalizeEmail(currentUser.email ?? ""));
        const profileCompleteAfterUpdate = isValidName(nextName) && isValidEmail(nextEmail);
        const shouldAwardProfileReward = !profileCompleteBeforeUpdate && profileCompleteAfterUpdate;

        const r = await client.query(
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
            await client.query("ROLLBACK");
            return res.status(404).json({ ok: false, error: "User not found" });
        }

        const user = r.rows[0];
        const rewardR = await client.query(
            `SELECT 1
             FROM reward_transactions
             WHERE user_id = $1
               AND reason = 'profile_completion'
             LIMIT 1`,
            [req.userId]
        );
        if (!rewardR.rowCount && shouldAwardProfileReward) {
            await client.query(
                `UPDATE users
                 SET points_balance = points_balance + $1, updated_at = now()
                 WHERE id = $2`,
                [PROFILE_COMPLETION_REWARD_POINTS, req.userId]
            );
            await client.query(
                `INSERT INTO reward_transactions (user_id, type, amount, reason)
                 VALUES ($1, 'earn', $2, 'profile_completion')`,
                [req.userId, PROFILE_COMPLETION_REWARD_POINTS]
            );
            user.points_balance = Number(user.points_balance ?? 0) + PROFILE_COMPLETION_REWARD_POINTS;
        }

        await client.query("COMMIT");
        return res.json({ ok: true, user });
    } catch (e) {
        await client.query("ROLLBACK");
        if (String(e).includes("duplicate key value") || String(e).includes("users_email_key")) {
            return res.status(409).json({ ok: false, error: "Email already in use" });
        }
        return serverError(res, e, "Unable to update profile right now");
    } finally {
        client.release();
    }
});

router.patch("/password", requireAuth, passwordUpdateRateLimit, async (req: AuthRequest, res) => {
    const parsedBody = parseWithSchema(passwordBodySchema, req.body ?? {}, res, "settings_password");
    if (!parsedBody.ok) return;
    const { currentPassword, newPassword } = parsedBody.data;

    if (!currentPassword.trim() || !newPassword.trim()) {
        return res.status(400).json({ ok: false, error: "currentPassword and newPassword are required" });
    }

    if (!isValidPassword(newPassword)) {
        return res.status(400).json({
            ok: false,
            error: `New ${PASSWORD_REQUIREMENTS_TEXT.charAt(0).toLowerCase()}${PASSWORD_REQUIREMENTS_TEXT.slice(1)}`,
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

        await pool.query(
            `UPDATE users
             SET password_hash = $1,
                 token_version = token_version + 1,
                 updated_at = now()
             WHERE id = $2`,
            [newHash, req.userId]
        );

        const updatedUserR = await pool.query(`SELECT token_version FROM users WHERE id = $1`, [req.userId]);
        if (!updatedUserR.rowCount) {
            return res.status(404).json({ ok: false, error: "User not found" });
        }

        return res.json({
            ok: true,
            token: issueAuthToken(req.userId!, Number(updatedUserR.rows[0].token_version ?? 0)),
        });
    } catch (e) {
        return serverError(res, e, "Unable to update password right now");
    }
});

router.delete("/account", requireAuth, deleteAccountRateLimit, async (req: AuthRequest, res) => {
    try {
        const deleted = await pool.query(
            `DELETE FROM users
             WHERE id = $1
             RETURNING id`,
            [req.userId]
        );
        if (!deleted.rowCount) {
            return res.status(404).json({ ok: false, error: "User not found" });
        }
        return res.json({ ok: true });
    } catch (e) {
        return serverError(res, e, "Unable to delete account right now");
    }
});

export default router;
