import { Router } from "express";
import { pool } from "../db";
import { requireAuth, AuthRequest } from "../middleware/auth";

const router = Router();

// small fixed reward for a money booking (simple + demonstrable for PDD)
const POINTS_EARN_PER_MONEY_BOOKING = 10;

function isIsoDateString(s: unknown): s is string {
    return typeof s === "string" && !Number.isNaN(Date.parse(s));
}

/**
 * POST /bookings
 * Body:
 * {
 *   "parking_spot_id": "uuid",
 *   "start_time": "2026-02-04T18:00:00.000Z",
 *   "end_time": "2026-02-04T20:00:00.000Z",
 *   "pay_method": "money" | "points"
 * }
 */
router.post("/", requireAuth, async (req: AuthRequest, res) => {
    const { parking_spot_id, start_time, end_time, pay_method } = req.body ?? {};

    if (typeof parking_spot_id !== "string") {
        return res.status(400).json({ ok: false, error: "parking_spot_id is required" });
    }

    if (!isIsoDateString(start_time) || !isIsoDateString(end_time)) {
        return res.status(400).json({ ok: false, error: "start_time and end_time must be ISO date strings" });
    }

    const start = new Date(start_time);
    const end = new Date(end_time);

    if (!(start < end)) {
        return res.status(400).json({ ok: false, error: "start_time must be before end_time" });
    }

    const method = pay_method === "points" ? "points" : "money";

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        // 1) Load spot
        const spotR = await client.query(
            `SELECT id, owner_user_id, title, mode, price_gbp, allow_points, points_cost, is_active
       FROM parking_spots
       WHERE id = $1`,
            [parking_spot_id]
        );

        if (!spotR.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ ok: false, error: "Parking spot not found" });
        }

        const spot = spotR.rows[0];

        if (!spot.is_active) {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: "Parking spot is not active" });
        }

        // Prevent booking your own spot (logical + minimal)
        if (spot.owner_user_id === req.userId) {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: "You cannot book your own parking spot" });
        }

        // 2) Determine totals
        let total_price_gbp = "0.00";
        let total_points = 0;
        let status = "pending";

        if (method === "points") {
            if (!spot.allow_points) {
                await client.query("ROLLBACK");
                return res.status(400).json({ ok: false, error: "This spot cannot be booked with points" });
            }

            total_points = Number(spot.points_cost ?? 0);
            if (total_points <= 0) {
                await client.query("ROLLBACK");
                return res.status(400).json({ ok: false, error: "Invalid points cost for this spot" });
            }

            status = "confirmed";
        } else {
            // money booking: use price_gbp as a simple “per booking” amount
            total_price_gbp = String(spot.price_gbp ?? "0.00");
            status = "pending";
        }

        // 3) If points booking: check user points and deduct
        if (method === "points") {
            const userR = await client.query(
                `SELECT id, points_balance FROM users WHERE id = $1`,
                [req.userId]
            );

            if (!userR.rowCount) {
                await client.query("ROLLBACK");
                return res.status(404).json({ ok: false, error: "User not found" });
            }

            const balance = Number(userR.rows[0].points_balance ?? 0);

            if (balance < total_points) {
                await client.query("ROLLBACK");
                return res.status(400).json({ ok: false, error: "Not enough points" });
            }

            await client.query(
                `UPDATE users SET points_balance = points_balance - $1, updated_at = now()
         WHERE id = $2`,
                [total_points, req.userId]
            );
        }

        // 4) Create booking
        const bookingR = await client.query(
            `INSERT INTO bookings (
        parking_spot_id,
        driver_user_id,
        start_time,
        end_time,
        status,
        pay_method,
        total_price_gbp,
        total_points
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *`,
            [
                parking_spot_id,
                req.userId,
                start_time,
                end_time,
                status,
                method,
                total_price_gbp,
                total_points,
            ]
        );

        const booking = bookingR.rows[0];

        // 5) Rewards + payments records (simple, PDD-aligned)
        if (method === "points") {
            // record spend
            await client.query(
                `INSERT INTO reward_transactions (user_id, type, amount, reason, related_booking_id, related_spot_id)
         VALUES ($1,'spend',$2,'booking_with_points',$3,$4)`,
                [req.userId, total_points, booking.id, parking_spot_id]
            );
        } else {
            // create a payment placeholder row (real Stripe later)
            await client.query(
                `INSERT INTO payments (booking_id, provider, status, amount_gbp)
         VALUES ($1,'stripe','created',$2)`,
                [booking.id, total_price_gbp]
            );

            // reward points for buying (simple demonstration)
            await client.query(
                `UPDATE users SET points_balance = points_balance + $1, updated_at = now()
         WHERE id = $2`,
                [POINTS_EARN_PER_MONEY_BOOKING, req.userId]
            );

            await client.query(
                `INSERT INTO reward_transactions (user_id, type, amount, reason, related_booking_id, related_spot_id)
         VALUES ($1,'earn',$2,'booking_purchase',$3,$4)`,
                [req.userId, POINTS_EARN_PER_MONEY_BOOKING, booking.id, parking_spot_id]
            );
        }

        await client.query("COMMIT");
        return res.status(201).json({ ok: true, booking });
    } catch (e) {
        await client.query("ROLLBACK");
        return res.status(500).json({ ok: false, error: String(e) });
    } finally {
        client.release();
    }
});

/**
 * GET /bookings/me
 * Returns current user's bookings (for dashboard)
 */
router.get("/me", requireAuth, async (req: AuthRequest, res) => {
    try {
        const r = await pool.query(
            `SELECT
         b.*,
         ps.title AS spot_title,
         ps.address_text AS spot_address,
         ps.lat AS spot_lat,
         ps.lng AS spot_lng
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

export default router;