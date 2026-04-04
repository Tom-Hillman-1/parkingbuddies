import { Router } from "express";
import type { Response } from "express";
import type { PoolClient } from "pg";
import { pool } from "../db";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { calcBookingUnits, type PriceUnit, STRIPE_MIN_GBP_PAYMENT, toMoney } from "../lib/shared";
import { findSlotAvailabilityIssue, occupiedBookingWhereClause } from "../lib/availability";
import { z } from "zod";
import { parseWithSchema } from "../lib/validation";
import { serverError } from "../lib/errors";
import { simpleRateLimit } from "../lib/rateLimit";

const router = Router();
type Mode = "free" | "rent" | "auction";
const PENDING_BOOKING_HOLD_MINUTES = 30;
const bookingCreateRateLimit = simpleRateLimit({
    windowMs: 60 * 1000,
    max: 12,
    message: "Too many booking attempts. Please wait a moment and try again.",
    keyPrefix: "bookings_create",
});

const bookingCreateBodySchema = z.object({
    parking_spot_id: z.string().uuid("parking_spot_id must be a valid listing ID"),
    start_time: z.string().trim().min(1),
    end_time: z.string().trim().min(1),
    pay_method: z.enum(["money", "points"]).optional(),
    points_amount: z.coerce.number().optional(),
});
const bookingIdParamsSchema = z.object({
    id: z.string().uuid("id must be a valid booking ID"),
});
const spotIdParamsSchema = z.object({
    id: z.string().uuid("id must be a valid listing ID"),
});

async function expireStalePendingBookings() {
    await pool.query(
        `UPDATE bookings
         SET status = 'cancelled', updated_at = now()
         WHERE status = 'pending'
           AND created_at < now() - ($1 * interval '1 minute')`,
        [PENDING_BOOKING_HOLD_MINUTES]
    );
}

function isIsoDateString(s: unknown): s is string {
    return typeof s === "string" && !Number.isNaN(Date.parse(s));
}

async function rollbackWithError(client: PoolClient, res: Response, status: number, error: string) {
    await client.query("ROLLBACK");
    return res.status(status).json({ ok: false, error });
}

router.post("/", requireAuth, bookingCreateRateLimit, async (req: AuthRequest, res) => {
    const parsedBody = parseWithSchema(bookingCreateBodySchema, req.body ?? {}, res, "booking");
    if (!parsedBody.ok) return;
    const { parking_spot_id, start_time, end_time, pay_method } = parsedBody.data;

    if (!isIsoDateString(start_time) || !isIsoDateString(end_time)) {
        return res.status(400).json({ ok: false, error: "start_time and end_time must be ISO date strings" });
    }

    const requestedStart = new Date(start_time);
    const requestedEnd = new Date(end_time);

    if (!(requestedStart < requestedEnd)) {
        return res.status(400).json({ ok: false, error: "start_time must be before end_time" });
    }
    if (requestedStart < new Date()) {
        return res.status(400).json({ ok: false, error: "start_time must be in the future" });
    }

    const method = pay_method === "points" ? "points" : "money";

    const client = await pool.connect();
    try {
        await expireStalePendingBookings();
        await client.query("BEGIN");
        // Serialize direct booking attempts per listing so the availability
        // check and insert cannot race each other under concurrent load.
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [parking_spot_id]);
        const spotR = await client.query(
            `SELECT
                 id,
                 owner_user_id,
                 mode,
                 price_gbp,
                 price_unit,
                 allow_points,
                 points_cost,
                 is_active,
                 availability_json,
                 capacity_total
             FROM parking_spots
             WHERE id = $1`,
            [parking_spot_id]
        );

        if (!spotR.rowCount) {
            return rollbackWithError(client, res, 404, "Parking spot not found");
        }

        const spot = spotR.rows[0] as any;
        if (spot.capacity_total == null) spot.capacity_total = 1;

        if (!spot.is_active) {
            return rollbackWithError(client, res, 400, "Parking spot is not active");
        }

        if (spot.owner_user_id === req.userId) {
            return rollbackWithError(client, res, 400, "You cannot book your own parking spot");
        }
        if ((spot.mode as Mode) === "auction") {
            return rollbackWithError(client, res, 400, "Auction bookings are created when the owner accepts a bid.");
        }

        const unit: PriceUnit = (spot.price_unit ?? "hour") as PriceUnit;
        if (!["hour", "day", "week"].includes(unit)) {
            return rollbackWithError(client, res, 400, "Spot price_unit is invalid");
        }
        const start = requestedStart;
        const end = requestedEnd;
        const startIso = start.toISOString();
        const endIso = end.toISOString();
        const slotIssue = await findSlotAvailabilityIssue({
            db: client,
            parkingSpotId: parking_spot_id,
            spot,
            start,
            end,
        });
        if (slotIssue) {
            return rollbackWithError(client, res, 400, slotIssue);
        }

        const units = calcBookingUnits(start, end, unit);

        let total_price_gbp = "0.00";
        let total_points = 0;
        let status: "pending" | "confirmed" = "pending";

        if (method === "points") {
            if (!spot.allow_points) {
                return rollbackWithError(client, res, 400, "This spot cannot be booked with points");
            }

            const perUnitPoints = Number(spot.points_cost ?? 0);
            if (!Number.isFinite(perUnitPoints) || perUnitPoints <= 0) {
                return rollbackWithError(client, res, 400, "Invalid points cost for this spot");
            }

            const minPoints = Math.ceil(perUnitPoints * units);
            total_points = minPoints;
            status = "confirmed";
        } else {
            const perUnitPrice = toMoney(spot.price_gbp);
            if ((spot.mode as Mode) === "rent" && perUnitPrice <= 0 && spot.allow_points) {
                return rollbackWithError(client, res, 400, "This spot only accepts points bookings");
            }
            const total = perUnitPrice * units;
            if ((spot.mode as Mode) === "free" || total <= 0) {
                total_price_gbp = "0.00";
                status = "confirmed";
            } else {
                if (total < STRIPE_MIN_GBP_PAYMENT) {
                    return rollbackWithError(
                        client,
                        res,
                        400,
                        `Card payments in GBP must be at least £${STRIPE_MIN_GBP_PAYMENT.toFixed(2)}. Pick a longer slot or use points instead.`
                    );
                }
                total_price_gbp = total.toFixed(2);
                status = "pending";
            }
        }
        if (method === "points") {
            const deductedR = await client.query(
                `UPDATE users
                 SET points_balance = points_balance - $1, updated_at = now()
                 WHERE id = $2
                   AND points_balance >= $1
                 RETURNING points_balance`,
                [total_points, req.userId]
            );

            if (!deductedR.rowCount) {
                const balanceR = await client.query(`SELECT points_balance FROM users WHERE id = $1`, [req.userId]);
                if (!balanceR.rowCount) {
                    return rollbackWithError(client, res, 404, "User not found");
                }
                const balance = Number(balanceR.rows[0].points_balance ?? 0);
                return rollbackWithError(client, res, 400, `Not enough points. Need ${total_points ?? 0}, you have ${balance}.`);
            }
        }
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
            [parking_spot_id, req.userId, startIso, endIso, status, method, total_price_gbp, total_points]
        );

        const booking = bookingR.rows[0];

        if (method === "points") {
            await client.query(
                `INSERT INTO reward_transactions (user_id, type, amount, reason, related_booking_id, related_spot_id)
                 VALUES ($1,'spend',$2,'booking_with_points',$3,$4)`,
                [req.userId, total_points, booking.id, parking_spot_id]
            );
            await client.query(
                `UPDATE users
                 SET points_balance = points_balance + $1, updated_at = now()
                 WHERE id = $2`,
                [total_points, spot.owner_user_id]
            );
            await client.query(
                `INSERT INTO reward_transactions (user_id, type, amount, reason, related_booking_id, related_spot_id)
                 VALUES ($1,'earn',$2,'booking_points_received',$3,$4)`,
                [spot.owner_user_id, total_points, booking.id, parking_spot_id]
            );
        } else {
            if (Number(total_price_gbp) > 0) {
                await client.query(
                    `INSERT INTO payments (booking_id, provider, status, amount_gbp)
           VALUES ($1,'stripe','created',$2)`,
                    [booking.id, total_price_gbp]
                );
            }
        }

        await client.query("COMMIT");
        return res.status(201).json({ ok: true, booking });
    } catch (e) {
        await client.query("ROLLBACK");
        return serverError(res, e, "Unable to create booking right now");
    } finally {
        client.release();
    }
});

router.get("/spot/:id", async (req, res) => {
    const parsedParams = parseWithSchema(spotIdParamsSchema, req.params ?? {}, res, "spot_bookings");
    if (!parsedParams.ok) return;
    const spotId = parsedParams.data.id;
    const start = typeof req.query.start === "string" ? req.query.start : null;
    const end = typeof req.query.end === "string" ? req.query.end : null;

    try {
        await expireStalePendingBookings();
        let r;
        if (start && end && isIsoDateString(start) && isIsoDateString(end)) {
            r = await pool.query(
                `SELECT b.start_time, b.end_time
                 FROM bookings b
                 WHERE b.parking_spot_id = $1
                   AND ${occupiedBookingWhereClause("b")}
                   AND NOT (b.end_time <= $2 OR b.start_time >= $3)
                 ORDER BY b.start_time ASC`,
                [spotId, start, end]
            );
        } else {
            r = await pool.query(
                `SELECT b.start_time, b.end_time
                 FROM bookings b
                 WHERE b.parking_spot_id = $1
                   AND ${occupiedBookingWhereClause("b")}
                 ORDER BY b.start_time ASC`,
                [spotId]
            );
        }
        return res.json({ ok: true, bookings: r.rows });
    } catch (e) {
        return serverError(res, e, "Unable to load bookings right now");
    }
});

router.get("/me", requireAuth, async (req: AuthRequest, res) => {
    try {
        const r = await pool.query(
            `SELECT
                     b.*,
                     ps.title AS spot_title,
                     ps.address_text AS spot_address,
                     ps.lat AS spot_lat,
                     ps.lng AS spot_lng,
                     ps.owner_user_id AS owner_user_id,
                     CASE
                         WHEN b.pay_method = 'money'
                              AND b.total_price_gbp > 0
                              AND COALESCE(pay.status, '') <> 'succeeded' THEN NULL
                         ELSE ps.owner_contact_email
                     END AS owner_contact_email,
                     CASE
                         WHEN b.pay_method = 'money'
                              AND b.total_price_gbp > 0
                              AND COALESCE(pay.status, '') <> 'succeeded' THEN NULL
                         ELSE ps.owner_contact_phone
                     END AS owner_contact_phone,
                     CASE
                         WHEN b.pay_method = 'money'
                              AND b.total_price_gbp > 0
                              AND COALESCE(pay.status, '') <> 'succeeded' THEN NULL
                         ELSE ps.owner_contact_info
                     END AS owner_contact_info,
                     pay.status AS payment_status
                 FROM bookings b
                          JOIN parking_spots ps ON ps.id = b.parking_spot_id
                           LEFT JOIN LATERAL (
                               SELECT p.status
                               FROM payments p
                               WHERE p.booking_id = b.id
                               ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC, p.id DESC
                               LIMIT 1
                           ) pay ON TRUE
                 WHERE b.driver_user_id = $1
                 ORDER BY b.created_at DESC`,
            [req.userId]
        );

        return res.json({ ok: true, bookings: r.rows });
    } catch (e) {
        return serverError(res, e, "Unable to load your bookings right now");
    }
});

router.patch("/:id/cancel", requireAuth, async (req: AuthRequest, res) => {
    const parsedParams = parseWithSchema(bookingIdParamsSchema, req.params ?? {}, res, "booking_cancel");
    if (!parsedParams.ok) return;
    const bookingId = parsedParams.data.id;

    try {
        const bookingR = await pool.query(
            `SELECT b.*,
                    pay.status AS payment_status,
                    pay.updated_at AS payment_updated_at
             FROM bookings b
             LEFT JOIN LATERAL (
                 SELECT p.status, p.updated_at
                 FROM payments p
                 WHERE p.booking_id = b.id
                 ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC, p.id DESC
                 LIMIT 1
             ) pay ON TRUE
             WHERE b.id = $1
               AND b.driver_user_id = $2`,
            [bookingId, req.userId]
        );

        if (!bookingR.rowCount) {
            return res.status(404).json({ ok: false, error: "Booking not found" });
        }

        const booking = bookingR.rows[0];
        if (booking.status !== "pending") {
            return res.status(400).json({ ok: false, error: "Only pending bookings can be cancelled" });
        }
        const activePendingPayment =
            booking.payment_status === "pending" &&
            booking.payment_updated_at &&
            new Date(booking.payment_updated_at).getTime() >= Date.now() - PENDING_BOOKING_HOLD_MINUTES * 60 * 1000;
        if (booking.payment_status === "succeeded" || activePendingPayment) {
            return res.status(409).json({
                ok: false,
                error: "Booking cannot be cancelled after payment has started or after it has been paid.",
            });
        }

        const r = await pool.query(
            `UPDATE bookings
             SET status = 'cancelled', updated_at = now()
             WHERE id = $1
               AND driver_user_id = $2
               AND status = 'pending'
             RETURNING *`,
            [bookingId, req.userId]
        );

        return res.json({ ok: true, booking: r.rows[0] });
    } catch (e) {
        return serverError(res, e, "Unable to cancel booking right now");
    }
});

router.get("/owner", requireAuth, async (req: AuthRequest, res) => {
    try {
        const r = await pool.query(
            `SELECT
                 b.*,
                 ps.title AS spot_title,
                 ps.address_text AS spot_address,
                 ps.owner_user_id AS owner_user_id,
                 ps.mode AS spot_mode
             FROM bookings b
                      JOIN parking_spots ps ON ps.id = b.parking_spot_id
             WHERE ps.owner_user_id = $1
             ORDER BY b.created_at DESC`,
            [req.userId]
        );

        return res.json({ ok: true, bookings: r.rows });
    } catch (e) {
        return serverError(res, e, "Unable to load owner bookings right now");
    }
});

router.get("/:id", requireAuth, async (req: AuthRequest, res) => {
    const parsedParams = parseWithSchema(bookingIdParamsSchema, req.params ?? {}, res, "booking_get");
    if (!parsedParams.ok) return;
    const bookingId = parsedParams.data.id;
    try {
        const r = await pool.query(
            `SELECT
                     b.*,
                     ps.title AS spot_title,
                     ps.address_text AS spot_address,
                     ps.lat AS spot_lat,
                     ps.lng AS spot_lng,
                     ps.image_url AS spot_image,
                     ps.mode AS spot_mode,
                     ps.price_gbp AS spot_price_gbp,
                     ps.price_unit AS spot_price_unit,
                     CASE
                         WHEN b.pay_method = 'money'
                              AND b.total_price_gbp > 0
                              AND COALESCE(pay.status, '') <> 'succeeded' THEN NULL
                         ELSE ps.owner_contact_email
                     END AS owner_contact_email,
                     CASE
                         WHEN b.pay_method = 'money'
                              AND b.total_price_gbp > 0
                              AND COALESCE(pay.status, '') <> 'succeeded' THEN NULL
                         ELSE ps.owner_contact_phone
                     END AS owner_contact_phone,
                     CASE
                         WHEN b.pay_method = 'money'
                              AND b.total_price_gbp > 0
                              AND COALESCE(pay.status, '') <> 'succeeded' THEN NULL
                         ELSE ps.owner_contact_info
                     END AS owner_contact_info,
                     pay.id AS payment_id,
                     pay.provider AS payment_provider,
                     pay.provider_ref AS payment_provider_ref,
                     pay.status AS payment_status
                 FROM bookings b
                 JOIN parking_spots ps ON ps.id = b.parking_spot_id
                  LEFT JOIN LATERAL (
                      SELECT
                          p.id,
                          p.provider,
                          p.provider_ref,
                          p.status
                      FROM payments p
                      WHERE p.booking_id = b.id
                      ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC, p.id DESC
                      LIMIT 1
                  ) pay ON TRUE
                 WHERE b.id = $1 AND b.driver_user_id = $2`,
            [bookingId, req.userId]
        );

        if (!r.rowCount) {
            return res.status(404).json({ ok: false, error: "Booking not found" });
        }

        return res.json({ ok: true, booking: r.rows[0] });
    } catch (e) {
        return serverError(res, e, "Unable to load booking right now");
    }
});

export default router;

