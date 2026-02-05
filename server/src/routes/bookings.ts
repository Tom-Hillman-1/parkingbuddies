import { Router } from "express";
import { pool } from "../db";
import { requireAuth, AuthRequest } from "../middleware/auth";

const router = Router();

// reward for a money booking (given AFTER confirmation)
const POINTS_EARN_PER_MONEY_BOOKING = 10;

type PriceUnit = "hour" | "day" | "week";
type Mode = "free" | "rent" | "auction";

// Availability json shapes
type AvailabilityJson =
    | { type: "24_7"; date_from?: string; date_to?: string }
    | { type: "same_everyday"; start: string; end: string; date_from?: string; date_to?: string }
    | { type: "custom_weekly"; rules: Array<{ dow: number; start: string; end: string }>; date_from?: string; date_to?: string };

// Legacy support
type LegacyAvailabilityType = "24_7" | "weekly";

function isIsoDateString(s: unknown): s is string {
    return typeof s === "string" && !Number.isNaN(Date.parse(s));
}

function toMoney(x: any) {
    const n = Number(x ?? 0);
    return Number.isFinite(n) ? n : 0;
}

// Charge by 5-minute increments for hourly listings
function calcUnits(start: Date, end: Date, unit: PriceUnit) {
    const ms = end.getTime() - start.getTime();
    const minutes = ms / (1000 * 60);

    if (unit === "hour") {
        const roundedMinutes = Math.max(5, Math.ceil(minutes / 5) * 5);
        return roundedMinutes / 60;
    }
    if (unit === "day") return Math.max(1, Math.ceil(minutes / (60 * 24)));
    return Math.max(1, Math.ceil(minutes / (60 * 24 * 7)));
}

function hhmmToMinutes(hhmm: string) {
    const [h, m] = hhmm.split(":").map((x) => Number(x));
    return h * 60 + m;
}

function timeHHMMUtc(d: Date) {
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mm = String(d.getUTCMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
}

function sameUtcDate(a: Date, b: Date) {
    return (
        a.getUTCFullYear() === b.getUTCFullYear() &&
        a.getUTCMonth() === b.getUTCMonth() &&
        a.getUTCDate() === b.getUTCDate()
    );
}

function normalizeDbTimeToHHMM(x: any): string | null {
    if (!x) return null;
    const s = String(x);
    // handles "HH:MM:SS" or "HH:MM"
    return s.length >= 5 ? s.slice(0, 5) : null;
}

function validateWithinWindowUtc(start: Date, end: Date, windowStartHHMM: string, windowEndHHMM: string) {
    // strict: booking must be within a single day for windowed availability
    if (!sameUtcDate(start, end)) {
        return { ok: false as const, error: "Booking must be within a single day for this availability type" };
    }

    const sMin = hhmmToMinutes(timeHHMMUtc(start));
    const eMin = hhmmToMinutes(timeHHMMUtc(end));
    const aMin = hhmmToMinutes(windowStartHHMM);
    const bMin = hhmmToMinutes(windowEndHHMM);

    if (sMin < aMin || eMin > bMin) {
        return { ok: false as const, error: `Booking must be within ${windowStartHHMM}–${windowEndHHMM} (UTC)` };
    }

    return { ok: true as const };
}

/**
 * Availability check priority:
 * 1) availability_json (new)
 * 2) legacy weekly fields (availability_type + available_days + daily_start/end)
 */
function validateAvailability(spot: any, start: Date, end: Date): { ok: true } | { ok: false; error: string } {
    const av: AvailabilityJson | null = spot.availability_json ?? null;

    // optional date window (YYYY-MM-DD)
    if (av?.date_from || av?.date_to) {
        const from = av.date_from ? new Date(`${av.date_from}T00:00:00Z`) : null;
        const to = av.date_to ? new Date(`${av.date_to}T23:59:59Z`) : null;
        if (from && start < from) return { ok: false, error: "Booking is before the available date range" };
        if (from && end < from) return { ok: false, error: "Booking is before the available date range" };
        if (to && start > to) return { ok: false, error: "Booking is after the available date range" };
        if (to && end > to) return { ok: false, error: "Booking is after the available date range" };
    }

    // ✅ New JSON availability
    if (av && typeof av === "object") {
        if (av.type === "24_7") return { ok: true };

        if (av.type === "same_everyday") {
            if (!av.start || !av.end) return { ok: false, error: "Spot availability is misconfigured" };
            const r = validateWithinWindowUtc(start, end, av.start, av.end);
            return r.ok ? { ok: true } : r;
        }

        if (av.type === "custom_weekly") {
            if (!Array.isArray(av.rules) || av.rules.length === 0) {
                return { ok: false, error: "Spot availability is misconfigured" };
            }

            // must be same day for rule windows
            if (!sameUtcDate(start, end)) {
                return { ok: false, error: "Booking must be within a single day for this spot’s availability rules" };
            }

            const dow = start.getUTCDay(); // 0..6
            const todaysRules = av.rules.filter((r) => r.dow === dow);

            if (todaysRules.length === 0) return { ok: false, error: "This spot is not available on that day" };

            // booking is valid if it fits ANY rule for that day
            for (const rule of todaysRules) {
                const r = validateWithinWindowUtc(start, end, rule.start, rule.end);
                if (r.ok) return { ok: true };
            }

            return { ok: false, error: "Booking does not fit within the available time windows (UTC)" };
        }

        return { ok: false, error: "Spot availability is misconfigured" };
    }

    // ✅ Legacy availability fallback
    const legacyType = (spot.availability_type ?? "24_7") as LegacyAvailabilityType;
    if (legacyType === "24_7") return { ok: true };

    if (legacyType === "weekly") {
        if (!sameUtcDate(start, end)) {
            return { ok: false, error: "Booking must be within a single day for weekly availability" };
        }

        const days: number[] = Array.isArray(spot.available_days) ? spot.available_days : [];
        const dow = start.getUTCDay();

        if (!days.includes(dow)) return { ok: false, error: "This spot is not available on that day" };

        const ds = normalizeDbTimeToHHMM(spot.daily_start);
        const de = normalizeDbTimeToHHMM(spot.daily_end);

        if (!ds || !de) return { ok: false, error: "Spot weekly availability is misconfigured" };

        const r = validateWithinWindowUtc(start, end, ds, de);
        return r.ok ? { ok: true } : r;
    }

    return { ok: false, error: "Spot availability is invalid" };
}

/**
 * POST /bookings
 * Body:
 * {
 *   "parking_spot_id": "uuid",
 *   "start_time": "ISO",
 *   "end_time": "ISO",
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

        // Load spot
        await client.query("SAVEPOINT spot_select");

        let spotR;
        try {
            spotR = await client.query(
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
                 availability_type,
                 available_days,
                 daily_start,
                 daily_end,
                 parking_type,
                 capacity_total
             FROM parking_spots
             WHERE id = $1`,
                [parking_spot_id]
            );
        } catch (e: any) {
            const msg = String(e?.message || e);
            if (msg.includes("parking_type") || msg.includes("capacity_total")) {
                await client.query("ROLLBACK TO SAVEPOINT spot_select");
                spotR = await client.query(
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
                 availability_type,
                 available_days,
                 daily_start,
                 daily_end
             FROM parking_spots
             WHERE id = $1`,
                    [parking_spot_id]
                );
            } else {
                throw e;
            }
        }
        await client.query("RELEASE SAVEPOINT spot_select");

        if (!spotR.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ ok: false, error: "Parking spot not found" });
        }

        const spot = spotR.rows[0] as any;
        if (spot.parking_type == null) spot.parking_type = "private";
        if (spot.capacity_total == null) spot.capacity_total = 1;

        if (!spot.is_active) {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: "Parking spot is not active" });
        }

        if (spot.owner_user_id === req.userId) {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: "You cannot book your own parking spot" });
        }

        // Auction: only winning/accepted bidders can book
        let auctionBidAmount: number | null = null;
        if ((spot.mode as Mode) === "auction") {
            const bidR = await client.query(
                `SELECT amount_gbp, status
                 FROM auction_bids
                 WHERE parking_spot_id = $1 AND bidder_user_id = $2
                   AND status IN ('accepted','won')
                 ORDER BY created_at DESC
                 LIMIT 1`,
                [parking_spot_id, req.userId]
            );
            if (!bidR.rowCount) {
                await client.query("ROLLBACK");
                return res.status(400).json({
                    ok: false,
                    error: "Only the accepted or winning bidder can book this auction listing.",
                });
            }
            auctionBidAmount = toMoney(bidR.rows[0].amount_gbp);
            if (method === "points") {
                await client.query("ROLLBACK");
                return res.status(400).json({ ok: false, error: "Auction bookings must be paid with money" });
            }
        }

        // Availability validation
        const avail = validateAvailability(spot, start, end);
        if (!avail.ok) {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: avail.error });
        }

        // Prevent overlaps (confirmed only; pending does not block)
        const overlapR = await client.query(
            `SELECT COUNT(*)::int AS count
       FROM bookings
       WHERE parking_spot_id = $1
         AND status IN ('confirmed')
         AND NOT (end_time <= $2 OR start_time >= $3)`,
            [parking_spot_id, start_time, end_time]
        );

        const overlapCount = Number(overlapR.rows[0]?.count ?? 0);
        const isPublic = spot.parking_type === "public";
        const capacity = Number(spot.capacity_total ?? 1);
        if (!isPublic && overlapCount > 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: "That time slot is already booked" });
        }
        if (isPublic && overlapCount >= Math.max(1, capacity)) {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: "No spaces available for that time slot" });
        }

        // Determine totals
        const unit: PriceUnit = ((spot.mode as Mode) === "auction" ? "hour" : (spot.price_unit ?? "hour")) as PriceUnit;
        if (!["hour", "day", "week"].includes(unit)) {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: "Spot price_unit is invalid" });
        }

        const units = calcUnits(start, end, unit);

        let total_price_gbp = "0.00";
        let total_points = 0;
        let status: "pending" | "confirmed" = "pending";

        if (method === "points") {
            if (!spot.allow_points) {
                await client.query("ROLLBACK");
                return res.status(400).json({ ok: false, error: "This spot cannot be booked with points" });
            }

            const perUnitPoints = Number(spot.points_cost ?? 0);
            if (!Number.isFinite(perUnitPoints) || perUnitPoints <= 0) {
                await client.query("ROLLBACK");
                return res.status(400).json({ ok: false, error: "Invalid points cost for this spot" });
            }

            total_points = Math.ceil(perUnitPoints * units);
            status = "confirmed"; // points booking confirms immediately (simple)
        } else {
            // money booking
            const perUnitPrice =
                (spot.mode as Mode) === "auction"
                    ? toMoney(auctionBidAmount ?? 0)
                    : toMoney(spot.price_gbp);
            const total = perUnitPrice * units;

            // free listings can have total 0 and still be "confirmed" (no payment needed)
            if ((spot.mode as Mode) === "free" || total <= 0) {
                total_price_gbp = "0.00";
                status = "confirmed";
            } else {
                total_price_gbp = total.toFixed(2);
                status = "pending";
            }
        }

        // If points booking: check user points and deduct
        if (method === "points") {
            const userR = await client.query(`SELECT id, points_balance FROM users WHERE id = $1`, [req.userId]);

            if (!userR.rowCount) {
                await client.query("ROLLBACK");
                return res.status(404).json({ ok: false, error: "User not found" });
            }

            const balance = Number(userR.rows[0].points_balance ?? 0);
            if (balance < (total_points ?? 0)) {
                await client.query("ROLLBACK");
                return res.status(400).json({ ok: false, error: "Not enough points" });
            }

            await client.query(
                `UPDATE users
                 SET points_balance = points_balance - $1, updated_at = now()
                 WHERE id = $2`,
                [total_points, req.userId]
            );
        }

        // Create booking
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
            [parking_spot_id, req.userId, start_time, end_time, status, method, total_price_gbp, total_points]
        );

        const booking = bookingR.rows[0];

        if (method === "points") {
            await client.query(
                `INSERT INTO reward_transactions (user_id, type, amount, reason, related_booking_id, related_spot_id)
                 VALUES ($1,'spend',$2,'booking_with_points',$3,$4)`,
                    [req.userId, total_points, booking.id, parking_spot_id]
            );
        } else {
            // only create payment row if there is something to pay
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
        return res.status(500).json({ ok: false, error: String(e) });
    } finally {
        client.release();
    }
});

/**
 * GET /bookings/spot/:id
 * Public: confirmed bookings for a spot (times only).
 * Optional query params: start, end (ISO) to limit to a window.
 */
router.get("/spot/:id", async (req, res) => {
    const spotId = req.params.id;
    const start = typeof req.query.start === "string" ? req.query.start : null;
    const end = typeof req.query.end === "string" ? req.query.end : null;

    try {
        let r;
        if (start && end && isIsoDateString(start) && isIsoDateString(end)) {
            r = await pool.query(
                `SELECT id, parking_spot_id, start_time, end_time, status
                 FROM bookings
                 WHERE parking_spot_id = $1
                   AND status = 'confirmed'
                   AND NOT (end_time <= $2 OR start_time >= $3)
                 ORDER BY start_time ASC`,
                [spotId, start, end]
            );
        } else {
            r = await pool.query(
                `SELECT id, parking_spot_id, start_time, end_time, status
                 FROM bookings
                 WHERE parking_spot_id = $1
                   AND status = 'confirmed'
                 ORDER BY start_time ASC`,
                [spotId]
            );
        }
        return res.json({ ok: true, bookings: r.rows });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

/**
 * GET /bookings/availability?ids=uuid,uuid&start=ISO&end=ISO
 * Public: returns confirmed booking counts for each spot in a time window.
 */
router.get("/availability", async (req, res) => {
    const idsParam = typeof req.query.ids === "string" ? req.query.ids : "";
    const ids = idsParam.split(",").map((x) => x.trim()).filter(Boolean);
    if (!ids.length) return res.json({ ok: true, counts: {} });

    const start = typeof req.query.start === "string" ? req.query.start : null;
    const end = typeof req.query.end === "string" ? req.query.end : null;
    const now = new Date().toISOString();
    const s = start && isIsoDateString(start) ? start : now;
    const e = end && isIsoDateString(end) ? end : now;

    try {
        const r = await pool.query(
            `SELECT parking_spot_id, COUNT(*)::int AS count
             FROM bookings
             WHERE parking_spot_id = ANY($1)
               AND status = 'confirmed'
               AND NOT (end_time <= $2 OR start_time >= $3)
             GROUP BY parking_spot_id`,
            [ids, s, e]
        );
        const counts: Record<string, number> = {};
        for (const row of r.rows) counts[row.parking_spot_id] = Number(row.count || 0);
        return res.json({ ok: true, counts });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

/**
 * GET /bookings/window?ids=uuid,uuid&start=ISO&end=ISO
 * Public: confirmed bookings within a window, grouped by spot_id.
 */
router.get("/window", async (req, res) => {
    const idsParam = typeof req.query.ids === "string" ? req.query.ids : "";
    const ids = idsParam.split(",").map((x) => x.trim()).filter(Boolean);
    if (!ids.length) return res.json({ ok: true, bookings: {} });

    const start = typeof req.query.start === "string" ? req.query.start : null;
    const end = typeof req.query.end === "string" ? req.query.end : null;
    const now = new Date();
    const s = start && isIsoDateString(start) ? start : now.toISOString();
    const e =
        end && isIsoDateString(end)
            ? end
            : new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();

    try {
        const r = await pool.query(
            `SELECT id, parking_spot_id, start_time, end_time, status
             FROM bookings
             WHERE parking_spot_id = ANY($1)
               AND status = 'confirmed'
               AND NOT (end_time <= $2 OR start_time >= $3)
             ORDER BY start_time ASC`,
            [ids, s, e]
        );
        const grouped: Record<string, any[]> = {};
        for (const row of r.rows) {
            if (!grouped[row.parking_spot_id]) grouped[row.parking_spot_id] = [];
            grouped[row.parking_spot_id].push(row);
        }
        return res.json({ ok: true, bookings: grouped });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

/**
 * GET /bookings/me
 * Adds spot info (including owner_user_id for your dashboard UI)
 */
router.get("/me", requireAuth, async (req: AuthRequest, res) => {
    try {
        const r = await pool.query(
            `SELECT
                 b.*,
                 ps.title AS spot_title,
                 ps.address_text AS spot_address,
                 ps.lat AS spot_lat,
                 ps.lng AS spot_lng,
                 ps.owner_user_id AS owner_user_id
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
 * PATCH /bookings/:id/cancel
 * Driver cancels their own booking (pending only)
 */
router.patch("/:id/cancel", requireAuth, async (req: AuthRequest, res) => {
    const bookingId = req.params.id;

    try {
        const r = await pool.query(
            `UPDATE bookings
             SET status = 'cancelled', updated_at = now()
             WHERE id = $1
               AND driver_user_id = $2
               AND status = 'pending'
                 RETURNING *`,
            [bookingId, req.userId]
        );

        if (!r.rowCount) {
            return res.status(404).json({ ok: false, error: "Booking not found (or not yours, or not pending)" });
        }

        return res.json({ ok: true, booking: r.rows[0] });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

/**
 * PATCH /bookings/:id/confirm
 * Owner confirms a pending booking
 * Rewards are granted here for money bookings.
 */
router.patch("/:id/confirm", requireAuth, async (req: AuthRequest, res) => {
    const bookingId = req.params.id;

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const bookingR = await client.query(
            `SELECT b.*, ps.owner_user_id, ps.mode AS spot_mode
             FROM bookings b
                      JOIN parking_spots ps ON ps.id = b.parking_spot_id
             WHERE b.id = $1`,
            [bookingId]
        );

        if (!bookingR.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ ok: false, error: "Booking not found" });
        }

        const booking = bookingR.rows[0];

        if (booking.owner_user_id !== req.userId) {
            await client.query("ROLLBACK");
            return res.status(403).json({ ok: false, error: "Only the listing owner can confirm this booking" });
        }

        if (booking.spot_mode !== "auction") {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: "Owner confirmation is only required for auction bookings" });
        }

        if (booking.status !== "pending") {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: "Only pending bookings can be confirmed" });
        }

        const updatedR = await client.query(
            `UPDATE bookings
       SET status = 'confirmed', updated_at = now()
       WHERE id = $1
       RETURNING *`,
            [bookingId]
        );

        // if money booking, mark payment as succeeded + reward points NOW
        if (booking.pay_method === "money") {
            await client.query(
                `UPDATE payments
                 SET status = 'succeeded', updated_at = now()
                 WHERE booking_id = $1`,
                [bookingId]
            );

            // only reward if it actually was a paid booking
            const paid = Number(booking.total_price_gbp ?? 0) > 0;
            if (paid) {
                await client.query(
                    `UPDATE users
           SET points_balance = points_balance + $1, updated_at = now()
           WHERE id = $2`,
                    [POINTS_EARN_PER_MONEY_BOOKING, booking.driver_user_id]
                );

                await client.query(
                    `INSERT INTO reward_transactions (user_id, type, amount, reason, related_booking_id, related_spot_id)
           VALUES ($1,'earn',$2,'booking_purchase',$3,$4)`,
                    [booking.driver_user_id, POINTS_EARN_PER_MONEY_BOOKING, bookingId, booking.parking_spot_id]
                );
            }
        }

        await client.query("COMMIT");
        return res.json({ ok: true, booking: updatedR.rows[0] });
    } catch (e) {
        await client.query("ROLLBACK");
        return res.status(500).json({ ok: false, error: String(e) });
    } finally {
        client.release();
    }
});

/**
 * GET /bookings/owner
 * Bookings for spots owned by the current user
 */
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
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

/**
 * PATCH /bookings/:id/mark-paid
 * Driver marks a money booking as paid.
 * Updates booking status + payment status + rewards.
 */
router.patch("/:id/mark-paid", requireAuth, async (req: AuthRequest, res) => {
    const bookingId = req.params.id;

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const bookingR = await client.query(
            `SELECT b.*, ps.owner_user_id
             FROM bookings b
                      JOIN parking_spots ps ON ps.id = b.parking_spot_id
             WHERE b.id = $1`,
            [bookingId]
        );

        if (!bookingR.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ ok: false, error: "Booking not found" });
        }

        const booking = bookingR.rows[0];

        if (booking.driver_user_id !== req.userId) {
            await client.query("ROLLBACK");
            return res.status(403).json({ ok: false, error: "Only the driver can mark this booking as paid" });
        }

        if (booking.status !== "pending" || booking.pay_method !== "money") {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: "Booking is not payable" });
        }

        const updatedR = await client.query(
            `UPDATE bookings
       SET status = 'confirmed', updated_at = now()
       WHERE id = $1
       RETURNING *`,
            [bookingId]
        );

        // Mark payment as succeeded
        await client.query(
            `UPDATE payments
             SET status = 'succeeded', updated_at = now()
             WHERE booking_id = $1`,
            [bookingId]
        );

        // Reward points for paid booking
        const paid = Number(booking.total_price_gbp ?? 0) > 0;
        if (paid) {
            await client.query(
                `UPDATE users
           SET points_balance = points_balance + $1, updated_at = now()
           WHERE id = $2`,
                [POINTS_EARN_PER_MONEY_BOOKING, booking.driver_user_id]
            );

            await client.query(
                `INSERT INTO reward_transactions (user_id, type, amount, reason, related_booking_id, related_spot_id)
           VALUES ($1,'earn',$2,'booking_purchase',$3,$4)`,
                [booking.driver_user_id, POINTS_EARN_PER_MONEY_BOOKING, bookingId, booking.parking_spot_id]
            );
        }

        await client.query("COMMIT");
        return res.json({ ok: true, booking: updatedR.rows[0] });
    } catch (e) {
        await client.query("ROLLBACK");
        return res.status(500).json({ ok: false, error: String(e) });
    } finally {
        client.release();
    }
});

/**
 * GET /bookings/:id
 * Driver-only booking detail (includes spot info)
 */
router.get("/:id", requireAuth, async (req: AuthRequest, res) => {
    const bookingId = req.params.id;
    // guard against non-uuid paths
    if (!/^[0-9a-fA-F-]{36}$/.test(bookingId)) {
        return res.status(404).json({ ok: false, error: "Booking not found" });
    }
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
                 ps.price_unit AS spot_price_unit
             FROM bookings b
             JOIN parking_spots ps ON ps.id = b.parking_spot_id
             WHERE b.id = $1 AND b.driver_user_id = $2`,
            [bookingId, req.userId]
        );

        if (!r.rowCount) {
            return res.status(404).json({ ok: false, error: "Booking not found" });
        }

        return res.json({ ok: true, booking: r.rows[0] });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

export default router;
