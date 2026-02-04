import { Router } from "express";
import { pool } from "../db";
import { requireAuth, AuthRequest } from "../middleware/auth";

const router = Router();

/**
 * GET /dashboard/me
 * Returns: user basics + counts for listings/bookings
 */
router.get("/me", requireAuth, async (req: AuthRequest, res) => {
    try {
        const userR = await pool.query(
            `SELECT id, email, name, points_balance, created_at, updated_at
       FROM users
       WHERE id = $1`,
            [req.userId]
        );

        if (!userR.rowCount) {
            return res.status(404).json({ ok: false, error: "User not found" });
        }

        const listingsCountR = await pool.query(
            `SELECT COUNT(*)::int AS count
       FROM parking_spots
       WHERE owner_user_id = $1`,
            [req.userId]
        );

        const bookingsCountR = await pool.query(
            `SELECT COUNT(*)::int AS count
       FROM bookings
       WHERE driver_user_id = $1`,
            [req.userId]
        );

        return res.json({
            ok: true,
            user: userR.rows[0],
            counts: {
                my_listings: listingsCountR.rows[0].count,
                my_bookings: bookingsCountR.rows[0].count,
            },
        });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

/**
 * GET /dashboard/my-listings
 * Returns all listings created by the current user
 */
router.get("/my-listings", requireAuth, async (req: AuthRequest, res) => {
    try {
        const r = await pool.query(
            `SELECT *
       FROM parking_spots
       WHERE owner_user_id = $1
       ORDER BY created_at DESC`,
            [req.userId]
        );

        return res.json({ ok: true, listings: r.rows });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

/**
 * GET /dashboard/my-bookings
 * Returns bookings created by current user, including spot info
 */
router.get("/my-bookings", requireAuth, async (req: AuthRequest, res) => {
    try {
        const r = await pool.query(
            `SELECT
         b.*,
         ps.title AS spot_title,
         ps.address_text AS spot_address,
         ps.lat AS spot_lat,
         ps.lng AS spot_lng,
         ps.mode AS spot_mode,
         ps.price_gbp AS spot_price_gbp,
         ps.allow_points AS spot_allow_points,
         ps.points_cost AS spot_points_cost
       FROM bookings b
       JOIN parking_spots ps ON ps.id = b.parking_spot_id
       WHERE b.driver_user_id = $1
       ORDER BY b.created_at DESC`,
            [req.userId]
        );

        return res.json({ ok: true, bookings: r.rows });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

/**
 * GET /dashboard/rewards
 * Returns reward transaction history for the current user
 */
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
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

export default router;