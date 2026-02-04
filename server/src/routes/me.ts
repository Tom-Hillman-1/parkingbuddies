import { Router } from "express";
import { pool } from "../db";
import { requireAuth, AuthRequest } from "../middleware/auth";

const router = Router();

router.get("/", requireAuth, async (req: AuthRequest, res) => {
    try {
        const r = await pool.query(
            `SELECT id, email, name, points_balance, created_at, updated_at
       FROM users
       WHERE id = $1`,
            [req.userId]
        );

        if (!r.rowCount) {
            return res.status(404).json({ ok: false, error: "User not found" });
        }

        return res.json({ ok: true, user: r.rows[0] });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

export default router;