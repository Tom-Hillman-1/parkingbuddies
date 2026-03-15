import { Router } from "express";
import { pool } from "../db";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { serverError } from "../lib/errors";

const router = Router();

router.get("/rewards", requireAuth, async (req: AuthRequest, res) => {
    try {
        const r = await pool.query(
            `SELECT
         rt.*,
         ps.title AS spot_title
       FROM reward_transactions rt
       LEFT JOIN parking_spots ps ON ps.id = rt.related_spot_id
       WHERE rt.user_id = $1
       ORDER BY rt.created_at DESC`,
            [req.userId]
        );

        return res.json({ ok: true, rewards: r.rows });
    } catch (e) {
        return serverError(res, e, "Unable to load rewards right now");
    }
});

export default router;
