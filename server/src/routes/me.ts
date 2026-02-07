import { Router } from "express";
import { pool } from "../db";
import { requireAuth, AuthRequest } from "../middleware/auth";

const router = Router();

router.get("/", requireAuth, async (req: AuthRequest, res) => {
    try {
        const r = await pool.query(
            `SELECT id,
                    email,
                    name,
                    points_balance,
                    stripe_account_id,
                    stripe_charges_enabled,
                    stripe_payouts_enabled,
                    stripe_details_submitted,
                    created_at,
                    updated_at
             FROM users
             WHERE id = $1`,
            [req.userId]
        );

        if (!r.rowCount) {
            return res.status(404).json({ ok: false, error: "User not found" });
        }

        const pointsR = await pool.query(
            `SELECT COALESCE(SUM(CASE WHEN type = 'earn' THEN amount ELSE -amount END), 0) AS balance
             FROM reward_transactions
             WHERE user_id = $1`,
            [req.userId]
        );
        const computed = Number(pointsR.rows[0]?.balance ?? 0);
        const current = Number(r.rows[0].points_balance ?? 0);

        if (computed !== current) {
            try {
                await pool.query(
                    `UPDATE users SET points_balance = $1, updated_at = now() WHERE id = $2`,
                    [computed, req.userId]
                );
                r.rows[0].points_balance = computed;
            } catch {
                // If update fails, still return computed for UI accuracy.
                r.rows[0].points_balance = computed;
            }
        }

        return res.json({ ok: true, user: r.rows[0] });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

export default router;
