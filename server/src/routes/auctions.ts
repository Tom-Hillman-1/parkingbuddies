import { Router } from "express";
import { pool } from "../db";
import { requireAuth, AuthRequest } from "../middleware/auth";
import jwt from "jsonwebtoken";
import { stripe } from "../stripe";

const router = Router();

function toMoney(x: any) {
    const n = Number(x ?? 0);
    return Number.isFinite(n) ? n : 0;
}

function calcUnitsForMinutes(minutes: number) {
    if (!Number.isFinite(minutes) || minutes <= 0) return 0;
    const roundedMinutes = Math.max(5, Math.ceil(minutes / 5) * 5);
    return roundedMinutes / 60;
}

let auctionSchemaReady = false;
async function ensureAuctionBidSchema() {
    if (auctionSchemaReady) return;
    try {
        await pool.query(
            `ALTER TABLE auction_bids
             ADD COLUMN IF NOT EXISTS start_time timestamptz,
             ADD COLUMN IF NOT EXISTS end_time timestamptz,
             ADD COLUMN IF NOT EXISTS pay_method text,
             ADD COLUMN IF NOT EXISTS amount_points integer`
        );
        await pool.query(
            `ALTER TABLE auction_bids
             ALTER COLUMN status SET DEFAULT 'pending'`
        );
        await pool.query(
            `UPDATE auction_bids SET pay_method = 'money' WHERE pay_method IS NULL`
        );
        await pool.query(`UPDATE auction_bids SET status = 'pending' WHERE status IS NULL`);
        auctionSchemaReady = true;
    } catch {
        // Best-effort: if this fails, later queries will surface errors.
    }
}

function extractAvailabilityRules(spot: any) {
    const rules: Array<{ dow: number; start: string; end: string }> = [];
    const a = spot?.availability_json;

    if (a?.type === "24_7") {
        return Array.from({ length: 7 }).map((_, dow) => ({ dow, start: "00:00", end: "23:59" }));
    }
    if (a?.type === "same_everyday" && a.start && a.end) {
        return Array.from({ length: 7 }).map((_, dow) => ({ dow, start: a.start, end: a.end }));
    }
    if (a?.type === "custom_weekly" && Array.isArray(a.rules)) {
        return a.rules.slice();
    }

    if (spot?.availability_type === "24_7") {
        return Array.from({ length: 7 }).map((_, dow) => ({ dow, start: "00:00", end: "23:59" }));
    }
    if (spot?.availability_type === "weekly" && Array.isArray(spot?.available_days)) {
        const ds = spot?.daily_start?.slice(0, 5) ?? "00:00";
        const de = spot?.daily_end?.slice(0, 5) ?? "23:59";
        return spot.available_days.map((dow: number) => ({ dow, start: ds, end: de }));
    }
    return rules;
}

function setTime(d: Date, hhmm: string) {
    const [h, m] = hhmm.split(":").map((x) => Number(x));
    const out = new Date(d);
    out.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
    return out;
}

function buildAvailabilityWindows(spot: any, maxDaysForward = 30) {
    const rules = extractAvailabilityRules(spot);
    if (!rules.length) return [];

    const a: any = spot?.availability_json;
    const dateFrom = a?.date_from ? new Date(`${a.date_from}T00:00:00`) : null;
    const dateTo = a?.date_to ? new Date(`${a.date_to}T23:59:59`) : null;

    const now = new Date();
    const maxEnd = new Date(now.getTime() + maxDaysForward * 24 * 60 * 60 * 1000);
    const startDay = dateFrom && dateFrom > now ? new Date(dateFrom) : new Date(now);
    startDay.setHours(0, 0, 0, 0);

    const hardEnd = dateTo && dateTo < maxEnd ? new Date(dateTo) : maxEnd;
    hardEnd.setHours(23, 59, 59, 999);

    const windows: Array<{ start: Date; end: Date }> = [];
    for (let d = new Date(startDay); d <= hardEnd; d.setDate(d.getDate() + 1)) {
        const day = new Date(d);
        const dow = day.getDay();
        const dayRules = rules.filter((r) => r.dow === dow);
        for (const r of dayRules) {
            const start = setTime(day, r.start);
            const end = setTime(day, r.end);
            if (end <= now) continue;
            windows.push({ start, end });
        }
    }
    return windows;
}

function subtractBookings(
    window: { start: Date; end: Date },
    bookings: Array<{ start: Date; end: Date }>,
    capacity = 1
) {
    const safeCapacity = Math.max(1, Number.isFinite(capacity) ? Math.floor(capacity) : 1);

    if (safeCapacity > 1) {
        const events: Array<{ at: number; delta: number }> = [];
        for (const b of bookings) {
            if (b.end <= window.start || b.start >= window.end) continue;
            const startMs = Math.max(window.start.getTime(), b.start.getTime());
            const endMs = Math.min(window.end.getTime(), b.end.getTime());
            if (endMs <= startMs) continue;
            events.push({ at: startMs, delta: 1 });
            events.push({ at: endMs, delta: -1 });
        }

        if (!events.length) return [{ ...window }];

        events.sort((a, b) => (a.at === b.at ? a.delta - b.delta : a.at - b.at));
        const blocked: Array<{ start: Date; end: Date }> = [];
        let active = 0;
        let blockedStart: number | null = null;

        for (const event of events) {
            const before = active;
            active += event.delta;
            if (before < safeCapacity && active >= safeCapacity) {
                blockedStart = event.at;
            }
            if (before >= safeCapacity && active < safeCapacity && blockedStart != null && event.at > blockedStart) {
                blocked.push({ start: new Date(blockedStart), end: new Date(event.at) });
                blockedStart = null;
            }
        }

        let segments: Array<{ start: Date; end: Date }> = [{ ...window }];
        for (const b of blocked) {
            const next: Array<{ start: Date; end: Date }> = [];
            for (const seg of segments) {
                if (b.end <= seg.start || b.start >= seg.end) {
                    next.push(seg);
                } else {
                    if (b.start > seg.start) next.push({ start: seg.start, end: b.start });
                    if (b.end < seg.end) next.push({ start: b.end, end: seg.end });
                }
            }
            segments = next;
        }
        return segments;
    }

    let segments: Array<{ start: Date; end: Date }> = [{ ...window }];
    for (const b of bookings) {
        if (b.end <= window.start || b.start >= window.end) continue;
        const next: Array<{ start: Date; end: Date }> = [];
        for (const seg of segments) {
            if (b.end <= seg.start || b.start >= seg.end) {
                next.push(seg);
            } else {
                if (b.start > seg.start) next.push({ start: seg.start, end: b.start });
                if (b.end < seg.end) next.push({ start: b.end, end: seg.end });
            }
        }
        segments = next;
    }
    return segments;
}

function remainingMinutes(spot: any, approved: Array<{ start: Date; end: Date }>) {
    const windows = buildAvailabilityWindows(spot, 30);
    const capacity = Math.max(1, Number(spot?.capacity_total ?? 1));
    let total = 0;
    for (const w of windows) {
        const segments = subtractBookings(w, approved, capacity);
        for (const s of segments) {
            total += Math.max(0, (s.end.getTime() - s.start.getTime()) / 60000);
        }
    }
    return total;
}

function isValidDurationMinutes(minutes: number) {
    if (!Number.isFinite(minutes) || minutes <= 0) return false;
    if (minutes <= 8 * 60) return minutes % 15 === 0;
    if (minutes <= 23 * 60) return minutes % 60 === 0;
    if (minutes <= 30 * 24 * 60) return minutes % (24 * 60) === 0;
    return false;
}

function isSlotAllowed(spot: any, start: Date, end: Date) {
    if (!(start < end)) return false;
    const rules = extractAvailabilityRules(spot);
    if (!rules.length) return false;

    const a: any = spot?.availability_json;
    const isTwentyFourSeven = a?.type === "24_7" || (!a && (spot?.availability_type ?? "24_7") === "24_7");
    const dateFrom = a?.date_from ? new Date(`${a.date_from}T00:00:00`) : null;
    const dateTo = a?.date_to ? new Date(`${a.date_to}T23:59:59`) : null;
    if (dateFrom && start < dateFrom) return false;
    if (dateTo && end > dateTo) return false;

    if (isTwentyFourSeven) return true;

    if (start.toDateString() !== end.toDateString()) return false;
    const dow = start.getDay();
    const dayRules = rules.filter((r) => r.dow === dow);
    if (!dayRules.length) return false;

    for (const r of dayRules) {
        const ruleStart = setTime(start, r.start);
        const ruleEnd = setTime(start, r.end);
        if (start >= ruleStart && end <= ruleEnd) return true;
    }
    return false;
}

/**
 * GET /auctions/:spotId
 * Public: returns auction summary.
 * Auth: includes bidder info if owner.
 */
router.get("/:spotId", async (req, res) => {
    const spotId = req.params.spotId;

    try {
        await ensureAuctionBidSchema();

        const spotR = await pool.query(
            `SELECT id, owner_user_id, mode, auction_end, auction_start_price_gbp, availability_json, availability_type, available_days, daily_start, daily_end, capacity_total
             FROM parking_spots
             WHERE id = $1`,
            [spotId]
        );
        if (!spotR.rowCount) {
            return res.status(404).json({ ok: false, error: "Listing not found" });
        }

        const spot = spotR.rows[0] as any;
        if (spot.mode !== "auction") {
            return res.status(400).json({ ok: false, error: "Listing is not an auction" });
        }

        const highestR = await pool.query(
            `SELECT amount_gbp FROM auction_bids
             WHERE parking_spot_id = $1
               AND status = 'pending'
               AND pay_method = 'money'
             ORDER BY amount_gbp DESC, created_at ASC
             LIMIT 1`,
            [spotId]
        );
        const highest = highestR.rowCount ? toMoney(highestR.rows[0].amount_gbp) : 0;

        const highestPointsR = await pool.query(
            `SELECT amount_points FROM auction_bids
             WHERE parking_spot_id = $1
               AND status = 'pending'
               AND pay_method = 'points'
             ORDER BY amount_points DESC, created_at ASC
             LIMIT 1`,
            [spotId]
        );
        const highestPoints = highestPointsR.rowCount ? Number(highestPointsR.rows[0].amount_points ?? 0) : 0;

        const approvedR = await pool.query(
            `SELECT id, amount_gbp, amount_points, pay_method, status, start_time, end_time, created_at, updated_at
             FROM auction_bids
             WHERE parking_spot_id = $1 AND status = 'accepted'
             ORDER BY updated_at DESC, created_at DESC
             LIMIT 3`,
            [spotId]
        );

        const pendingR = await pool.query(
            `SELECT id, amount_gbp, amount_points, pay_method, status, start_time, end_time, created_at
             FROM auction_bids
             WHERE parking_spot_id = $1 AND status = 'pending'
             ORDER BY amount_gbp DESC, created_at ASC
             LIMIT 5`,
            [spotId]
        );

        const approvedBookings = approvedR.rows
            .filter((b: any) => b.start_time && b.end_time)
            .map((b: any) => ({ start: new Date(b.start_time), end: new Date(b.end_time) }));
        const remaining = remainingMinutes(spot, approvedBookings);
        const soldOut = remaining < 16;

        const auction: any = {
            highest_pending_bid_gbp: highest,
            highest_pending_bid_points: highestPoints,
            auction_end: spot.auction_end,
            auction_start_price_gbp: spot.auction_start_price_gbp,
            pending_bids: pendingR.rows,
            approved_bids: approvedR.rows,
            sold_out: soldOut,
        };

        // If owner is authenticated, include bid list here too.
        const header = req.headers.authorization;
        const secret = process.env.JWT_SECRET;
        if (header && header.startsWith("Bearer ") && secret) {
            try {
                const token = header.slice("Bearer ".length).trim();
                const payload = jwt.verify(token, secret) as { userId: string };
                if (payload.userId === spot.owner_user_id) {
                    const bidsR = await pool.query(
                        `SELECT b.id, b.amount_gbp, b.amount_points, b.pay_method, b.status, b.start_time, b.end_time, b.created_at, u.name AS bidder_name, u.email AS bidder_email
                         FROM auction_bids b
                         JOIN users u ON u.id = b.bidder_user_id
                         WHERE b.parking_spot_id = $1
                           AND b.status = 'pending'
                         ORDER BY b.amount_gbp DESC, b.created_at ASC
                         LIMIT 20`,
                        [spotId]
                    );
                    auction.pending_bids = bidsR.rows;
                }
            } catch {
                // ignore token errors for public endpoint
            }
        }

        return res.json({ ok: true, auction });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

/**
 * GET /auctions/:spotId/me
 * Returns the authenticated user's bids for this auction.
 */
router.get("/:spotId/me", requireAuth, async (req: AuthRequest, res) => {
    const spotId = req.params.spotId;
    try {
        await ensureAuctionBidSchema();

        const bidsR = await pool.query(
            `SELECT id, amount_gbp, amount_points, pay_method, status, start_time, end_time, created_at
             FROM auction_bids
             WHERE parking_spot_id = $1 AND bidder_user_id = $2
             ORDER BY created_at DESC
             LIMIT 50`,
            [spotId, req.userId]
        );

        if (!bidsR.rowCount) {
            return res.json({ ok: true, me: null, bids: [] });
        }

        // Keep `me` for backwards compatibility while also returning all bids.
        return res.json({ ok: true, me: bidsR.rows[0], bids: bidsR.rows });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

/**
 * GET /auctions/:spotId/owner
 * Owner-only: returns bid list with bidder info.
 */
router.get("/:spotId/owner", requireAuth, async (req: AuthRequest, res) => {
    const spotId = req.params.spotId;

    try {
        await ensureAuctionBidSchema();

        const spotR = await pool.query(
            `SELECT id, owner_user_id, mode, auction_end, auction_start_price_gbp
             FROM parking_spots
             WHERE id = $1`,
            [spotId]
        );
        if (!spotR.rowCount) {
            return res.status(404).json({ ok: false, error: "Listing not found" });
        }

        const spot = spotR.rows[0] as any;
        if (spot.mode !== "auction") {
            return res.status(400).json({ ok: false, error: "Listing is not an auction" });
        }
        if (spot.owner_user_id !== req.userId) {
            return res.status(403).json({ ok: false, error: "Only the owner can view bids" });
        }

        const bidsR = await pool.query(
            `SELECT b.id, b.amount_gbp, b.amount_points, b.pay_method, b.status, b.start_time, b.end_time, b.created_at, u.name AS bidder_name, u.email AS bidder_email
             FROM auction_bids b
             JOIN users u ON u.id = b.bidder_user_id
             WHERE b.parking_spot_id = $1
             ORDER BY b.amount_gbp DESC, b.created_at ASC`,
            [spotId]
        );

        const highestR = await pool.query(
            `SELECT amount_gbp FROM auction_bids
             WHERE parking_spot_id = $1 AND status = 'pending' AND pay_method = 'money'
             ORDER BY amount_gbp DESC, created_at ASC
             LIMIT 1`,
            [spotId]
        );
        const highest = highestR.rowCount ? toMoney(highestR.rows[0].amount_gbp) : 0;

        return res.json({
            ok: true,
            auction: {
                highest_pending_bid_gbp: highest,
                auction_end: spot.auction_end,
                auction_start_price_gbp: spot.auction_start_price_gbp,
                bids: bidsR.rows,
            },
        });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

/**
 * GET /auctions/owner/bids
 * Owner-only: returns all bids across owner's auction listings.
 */
router.get("/owner/bids", requireAuth, async (req: AuthRequest, res) => {
    try {
        await ensureAuctionBidSchema();
        const r = await pool.query(
            `SELECT
                 b.id,
                 b.parking_spot_id,
                 b.amount_gbp,
                 b.amount_points,
                 b.pay_method,
                 b.status,
                 b.created_at,
                 b.start_time,
                 b.end_time,
                 u.name AS bidder_name,
                 u.email AS bidder_email,
                 ps.title AS spot_title
             FROM auction_bids b
                      JOIN parking_spots ps ON ps.id = b.parking_spot_id
                      JOIN users u ON u.id = b.bidder_user_id
             WHERE ps.owner_user_id = $1
               AND ps.mode = 'auction'
             ORDER BY b.amount_gbp DESC, b.created_at ASC`,
            [req.userId]
        );

        return res.json({ ok: true, bids: r.rows });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

/**
 * GET /auctions/me/pending
 * Driver-only: pending bids across auctions.
 */
router.get("/me/pending", requireAuth, async (req: AuthRequest, res) => {
    try {
        await ensureAuctionBidSchema();
        const r = await pool.query(
            `SELECT b.id, b.parking_spot_id, b.amount_gbp, b.amount_points, b.pay_method, b.status, b.created_at, b.start_time, b.end_time, ps.title AS spot_title
             FROM auction_bids b
                      JOIN parking_spots ps ON ps.id = b.parking_spot_id
             WHERE b.bidder_user_id = $1
               AND b.status = 'pending'
             ORDER BY b.created_at DESC`,
            [req.userId]
        );
        return res.json({ ok: true, bids: r.rows });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

/**
 * GET /auctions/bids/:bidId
 * Auth: bidder or owner can view bid receipt details.
 */
router.get("/bids/:bidId", requireAuth, async (req: AuthRequest, res) => {
    const bidId = req.params.bidId;
    try {
        await ensureAuctionBidSchema();
        const r = await pool.query(
            `SELECT b.id,
                    b.parking_spot_id,
                    b.bidder_user_id,
                    b.amount_gbp,
                    b.amount_points,
                    b.pay_method,
                    b.status,
                    b.created_at,
                    b.start_time,
                    b.end_time,
                    ps.title AS spot_title,
                    ps.address_text AS spot_address,
                    ps.owner_user_id
             FROM auction_bids b
                      JOIN parking_spots ps ON ps.id = b.parking_spot_id
             WHERE b.id = $1`,
            [bidId]
        );
        if (!r.rowCount) {
            return res.status(404).json({ ok: false, error: "Bid not found" });
        }

        const row = r.rows[0] as any;
        if (row.bidder_user_id !== req.userId && row.owner_user_id !== req.userId) {
            return res.status(403).json({ ok: false, error: "Not authorized to view this bid" });
        }

        let bookingId: string | null = null;
        let paymentStatus: string | null = null;
        if ((row.pay_method ?? "money") === "money" && row.start_time && row.end_time) {
            const paymentR = await pool.query(
                `SELECT
                     b.id AS booking_id,
                     pay.status AS payment_status
                 FROM bookings b
                 LEFT JOIN LATERAL (
                     SELECT p.status
                     FROM payments p
                     WHERE p.booking_id = b.id
                     ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC, p.id DESC
                     LIMIT 1
                 ) pay ON TRUE
                 WHERE b.parking_spot_id = $1
                   AND b.driver_user_id = $2
                   AND b.start_time = $3
                   AND b.end_time = $4
                   AND b.pay_method = 'money'
                 ORDER BY b.created_at DESC
                 LIMIT 1`,
                [row.parking_spot_id, row.bidder_user_id, row.start_time, row.end_time]
            );
            if (paymentR.rowCount) {
                bookingId = paymentR.rows[0].booking_id ?? null;
                paymentStatus = paymentR.rows[0].payment_status ?? null;
            }
        }

        return res.json({
            ok: true,
            bid: {
                id: row.id,
                parking_spot_id: row.parking_spot_id,
                amount_gbp: row.amount_gbp,
                amount_points: row.amount_points,
                pay_method: row.pay_method ?? "money",
                status: row.status ?? "pending",
                created_at: row.created_at,
                start_time: row.start_time,
                end_time: row.end_time,
                spot_title: row.spot_title,
                spot_address: row.spot_address,
                booking_id: bookingId,
                payment_status: paymentStatus,
            },
        });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

/**
 * POST /auctions/:spotId/bid
 * Body: { amount_gbp }
 */
router.post("/:spotId/bid", requireAuth, async (req: AuthRequest, res) => {
    const spotId = req.params.spotId;
    const payMethod = req.body?.pay_method === "points" ? "points" : "money";
    const amount = toMoney(req.body?.amount_gbp);
    const amountPoints = Number(req.body?.amount_points);
    const paymentIntentId = req.body?.payment_intent_id;
    const startRaw = req.body?.start_time;
    const endRaw = req.body?.end_time;

    if (payMethod === "money") {
        if (!amount || amount <= 0) {
            return res.status(400).json({ ok: false, error: "Invalid bid amount" });
        }
        if (typeof paymentIntentId !== "string" || !paymentIntentId.trim()) {
            return res.status(400).json({ ok: false, error: "payment_intent_id is required" });
        }
    } else {
        if (!Number.isFinite(amountPoints) || amountPoints <= 0) {
            return res.status(400).json({ ok: false, error: "Invalid points bid amount" });
        }
    }
    if (typeof startRaw !== "string" || typeof endRaw !== "string") {
        return res.status(400).json({ ok: false, error: "start_time and end_time are required" });
    }
    const start = new Date(startRaw);
    const end = new Date(endRaw);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || !(start < end)) {
        return res.status(400).json({ ok: false, error: "Invalid start/end time" });
    }
    const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
    if (!isValidDurationMinutes(minutes)) {
        return res.status(400).json({ ok: false, error: "Invalid bid duration" });
    }
    const maxEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    if (end > maxEnd) {
        return res.status(400).json({ ok: false, error: "Bid duration exceeds 30 days limit" });
    }

    const client = await pool.connect();
    let bidId: string | null = null;
    try {
        await client.query("BEGIN");
        await ensureAuctionBidSchema();

        const spotR = await client.query(
            `SELECT id, owner_user_id, mode, auction_end, auction_start_price_gbp, allow_points, points_cost, availability_json, availability_type, available_days, daily_start, daily_end, capacity_total
             FROM parking_spots
             WHERE id = $1`,
            [spotId]
        );
        if (!spotR.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ ok: false, error: "Listing not found" });
        }

        const spot = spotR.rows[0] as any;
        if (spot.mode !== "auction") {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: "Listing is not an auction" });
        }
        if (spot.owner_user_id === req.userId) {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: "Owners cannot bid on their own listings" });
        }
        if (spot.auction_end && new Date(spot.auction_end) <= new Date()) {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: "Auction has ended" });
        }

        if (!isSlotAllowed(spot, start, end)) {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: "Requested slot is outside listing availability" });
        }

        const approvedR = await client.query(
            `SELECT start_time, end_time
             FROM auction_bids
             WHERE parking_spot_id = $1 AND status = 'accepted' AND start_time IS NOT NULL AND end_time IS NOT NULL`,
            [spotId]
        );
        const approved = approvedR.rows.map((b: any) => ({ start: new Date(b.start_time), end: new Date(b.end_time) }));
        const remaining = remainingMinutes(spot, approved);
        if (remaining < 16) {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: "Auction is sold out" });
        }

        for (const a of approved) {
            if (a.start < end && a.end > start) {
                await client.query("ROLLBACK");
                return res.status(400).json({ ok: false, error: "Selected slot is no longer available" });
            }
        }

        if (payMethod === "money") {
            const startPrice = toMoney(spot.auction_start_price_gbp);
            const units = calcUnitsForMinutes(minutes);
            const minTotal = Math.round(startPrice * units * 100) / 100;
            if (amount < minTotal) {
                await client.query("ROLLBACK");
                return res.status(400).json({ ok: false, error: `Bid must be at least £${minTotal.toFixed(2)} for the selected time` });
            }

            // verify payment intent (manual capture)
            const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
            if (
                intent.metadata?.user_id !== req.userId ||
                intent.metadata?.spot_id !== spotId ||
                intent.metadata?.owner_user_id !== spot.owner_user_id
            ) {
                await client.query("ROLLBACK");
                return res.status(400).json({ ok: false, error: "Payment intent does not match this bid" });
            }
            const amountPence = Math.round(amount * 100);
            if (intent.amount !== amountPence || intent.currency !== "gbp") {
                await client.query("ROLLBACK");
                return res.status(400).json({ ok: false, error: "Payment amount mismatch" });
            }
            if (intent.capture_method !== "manual") {
                await client.query("ROLLBACK");
                return res.status(400).json({ ok: false, error: "Invalid auction authorization type" });
            }
            if (intent.status !== "requires_capture") {
                await client.query("ROLLBACK");
                return res.status(400).json({ ok: false, error: "Card authorization not completed" });
            }

            const insertR = await client.query(
                `INSERT INTO auction_bids (parking_spot_id, bidder_user_id, amount_gbp, payment_intent_id, start_time, end_time, status, pay_method)
                 VALUES ($1,$2,$3,$4,$5,$6,'pending','money')
                 RETURNING id`,
                [spotId, req.userId, amount.toFixed(2), paymentIntentId, start.toISOString(), end.toISOString()]
            );
            bidId = insertR.rows[0]?.id ?? null;
        } else {
            if (!spot.allow_points) {
                await client.query("ROLLBACK");
                return res.status(400).json({ ok: false, error: "This auction does not accept points" });
            }
            const minPoints = Number(spot.points_cost ?? 0);
            if (!Number.isFinite(minPoints) || minPoints <= 0) {
                await client.query("ROLLBACK");
                return res.status(400).json({ ok: false, error: "Invalid points cost for this listing" });
            }
            if (amountPoints < minPoints) {
                await client.query("ROLLBACK");
                return res.status(400).json({ ok: false, error: `Bid must be at least ${minPoints} pts` });
            }

            const units = calcUnitsForMinutes(minutes);
            const totalPoints = Math.ceil(amountPoints * units);
            const userR = await client.query(
                `SELECT points_balance FROM users WHERE id = $1`,
                [req.userId]
            );
            if (!userR.rowCount) {
                await client.query("ROLLBACK");
                return res.status(404).json({ ok: false, error: "User not found" });
            }
            const balance = Number(userR.rows[0].points_balance ?? 0);
            if (balance < totalPoints) {
                await client.query("ROLLBACK");
                return res.status(400).json({ ok: false, error: `Not enough points (${totalPoints} required)` });
            }

            const insertR = await client.query(
                `INSERT INTO auction_bids (parking_spot_id, bidder_user_id, amount_gbp, amount_points, start_time, end_time, status, pay_method)
                 VALUES ($1,$2,$3,$4,$5,$6,'pending','points')
                 RETURNING id`,
                [spotId, req.userId, "0.00", Math.ceil(amountPoints), start.toISOString(), end.toISOString()]
            );
            bidId = insertR.rows[0]?.id ?? null;
        }

        await client.query("COMMIT");
    } catch (e) {
        await client.query("ROLLBACK");
        return res.status(500).json({ ok: false, error: String(e) });
    } finally {
        client.release();
    }

    // return updated auction summary
    const summary = await pool.query(
        `SELECT amount_gbp FROM auction_bids
         WHERE parking_spot_id = $1
           AND status = 'pending'
           AND pay_method = 'money'
         ORDER BY amount_gbp DESC, created_at ASC
         LIMIT 1`,
        [spotId]
    );
    const highest = summary.rowCount ? toMoney(summary.rows[0].amount_gbp) : 0;
    return res.json({ ok: true, auction: { highest_pending_bid_gbp: highest }, bid_id: bidId });
});

/**
 * POST /auctions/:spotId/accept
 * Body: { bid_id }
 */
router.post("/:spotId/accept", requireAuth, async (req: AuthRequest, res) => {
    const spotId = req.params.spotId;
    const bidId = req.body?.bid_id;

    if (typeof bidId !== "string") {
        return res.status(400).json({ ok: false, error: "bid_id is required" });
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await ensureAuctionBidSchema();

        const spotR = await client.query(
            `SELECT id, owner_user_id, mode, availability_json, availability_type, available_days, daily_start, daily_end, capacity_total
             FROM parking_spots
             WHERE id = $1`,
            [spotId]
        );
        if (!spotR.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ ok: false, error: "Listing not found" });
        }

        const spot = spotR.rows[0] as any;
        if (spot.mode !== "auction") {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: "Listing is not an auction" });
        }
        if (spot.owner_user_id !== req.userId) {
            await client.query("ROLLBACK");
            return res.status(403).json({ ok: false, error: "Only the owner can accept a bid" });
        }

        const bidInfoR = await client.query(
            `SELECT id, bidder_user_id, amount_gbp, amount_points, pay_method, payment_intent_id, start_time, end_time, status
             FROM auction_bids
             WHERE id = $1 AND parking_spot_id = $2`,
            [bidId, spotId]
        );
        if (!bidInfoR.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ ok: false, error: "Bid not found" });
        }

        const bidInfo = bidInfoR.rows[0];
        if ((bidInfo.status ?? "pending") !== "pending") {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: "Only pending bids can be accepted" });
        }
        if (!bidInfo.start_time || !bidInfo.end_time) {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: "Bid has no time slot" });
        }
        if ((bidInfo.pay_method ?? "money") === "money" && !bidInfo.payment_intent_id) {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: "Bid has no payment authorization" });
        }

        const start = new Date(bidInfo.start_time);
        const end = new Date(bidInfo.end_time);
        if (!isSlotAllowed(spot, start, end)) {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: "Bid slot is outside listing availability" });
        }

        const approvedR = await client.query(
            `SELECT start_time, end_time
             FROM auction_bids
             WHERE parking_spot_id = $1 AND status = 'accepted' AND start_time IS NOT NULL AND end_time IS NOT NULL`,
            [spotId]
        );
        const approved = approvedR.rows.map((b: any) => ({ start: new Date(b.start_time), end: new Date(b.end_time) }));
        for (const a of approved) {
            if (a.start < end && a.end > start) {
                await client.query("ROLLBACK");
                return res.status(400).json({ ok: false, error: "Slot already approved for another bid" });
            }
        }

        const remaining = remainingMinutes(spot, approved);
        if (remaining < 16) {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: "Auction is sold out" });
        }

        if ((bidInfo.pay_method ?? "money") === "money") {
            // capture payment
            const captured = await stripe.paymentIntents.capture(bidInfo.payment_intent_id);

            await client.query(
                `UPDATE auction_bids
                 SET status = 'accepted', updated_at = now()
                 WHERE id = $1`,
                [bidId]
            );

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
                 VALUES ($1,$2,$3,$4,'confirmed','money',$5,0)
                 RETURNING id`,
                [spotId, bidInfo.bidder_user_id, start.toISOString(), end.toISOString(), bidInfo.amount_gbp]
            );

            const bookingId = bookingR.rows[0]?.id;
            if (bookingId) {
                await client.query(
                    `INSERT INTO payments (
                        booking_id,
                        provider,
                        provider_ref,
                        status,
                        amount_gbp,
                        created_at,
                        updated_at
                    )
                     VALUES ($1, 'stripe', $2, 'succeeded', $3, now(), now())`,
                    [bookingId, captured.id, bidInfo.amount_gbp]
                );
            }
        } else {
            const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
            const units = calcUnitsForMinutes(minutes);
            const perHourPoints = Number(bidInfo.amount_points ?? 0);
            if (!Number.isFinite(perHourPoints) || perHourPoints <= 0) {
                await client.query("ROLLBACK");
                return res.status(400).json({ ok: false, error: "Invalid points bid" });
            }
            const totalPoints = Math.ceil(perHourPoints * units);

            const userR = await client.query(`SELECT id, points_balance FROM users WHERE id = $1`, [
                bidInfo.bidder_user_id,
            ]);
            if (!userR.rowCount) {
                await client.query("ROLLBACK");
                return res.status(404).json({ ok: false, error: "Bidder not found" });
            }
            const balance = Number(userR.rows[0].points_balance ?? 0);
            if (balance < totalPoints) {
                await client.query("ROLLBACK");
                return res.status(400).json({ ok: false, error: `Bidder does not have enough points (${totalPoints} required)` });
            }

            await client.query(
                `UPDATE users
                 SET points_balance = points_balance - $1, updated_at = now()
                 WHERE id = $2`,
                [totalPoints, bidInfo.bidder_user_id]
            );
            await client.query(
                `UPDATE users
                 SET points_balance = points_balance + $1, updated_at = now()
                 WHERE id = $2`,
                [totalPoints, spot.owner_user_id]
            );
            await client.query(
                `UPDATE auction_bids
                 SET status = 'accepted', updated_at = now()
                 WHERE id = $1`,
                [bidId]
            );

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
                 VALUES ($1,$2,$3,$4,'confirmed','points','0.00',$5)
                 RETURNING id`,
                [spotId, bidInfo.bidder_user_id, start.toISOString(), end.toISOString(), totalPoints]
            );

            const bookingId = bookingR.rows[0]?.id;
            if (bookingId) {
                await client.query(
                    `INSERT INTO reward_transactions (user_id, type, amount, reason, related_booking_id, related_spot_id)
                     VALUES ($1,'spend',$2,'auction_bid_points',$3,$4)`,
                    [bidInfo.bidder_user_id, totalPoints, bookingId, spotId]
                );
                await client.query(
                    `INSERT INTO reward_transactions (user_id, type, amount, reason, related_booking_id, related_spot_id)
                     VALUES ($1,'earn',$2,'auction_points_received',$3,$4)`,
                    [spot.owner_user_id, totalPoints, bookingId, spotId]
                );
            }
        }

        await client.query("COMMIT");
    } catch (e) {
        await client.query("ROLLBACK");
        return res.status(500).json({ ok: false, error: String(e) });
    } finally {
        client.release();
    }

    return res.json({ ok: true, auction: { accepted_bid_id: bidId } });
});

/**
 * POST /auctions/:spotId/reject
 * Body: { bid_id }
 */
router.post("/:spotId/reject", requireAuth, async (req: AuthRequest, res) => {
    const spotId = req.params.spotId;
    const bidId = req.body?.bid_id;

    if (typeof bidId !== "string") {
        return res.status(400).json({ ok: false, error: "bid_id is required" });
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const spotR = await client.query(
            `SELECT id, owner_user_id, mode
             FROM parking_spots
             WHERE id = $1`,
            [spotId]
        );
        if (!spotR.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ ok: false, error: "Listing not found" });
        }

        const spot = spotR.rows[0] as any;
        if (spot.mode !== "auction") {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: "Listing is not an auction" });
        }
        if (spot.owner_user_id !== req.userId) {
            await client.query("ROLLBACK");
            return res.status(403).json({ ok: false, error: "Only the owner can reject a bid" });
        }

        const bidR = await client.query(
            `SELECT id, payment_intent_id FROM auction_bids
             WHERE id = $1 AND parking_spot_id = $2`,
            [bidId, spotId]
        );
        if (!bidR.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ ok: false, error: "Bid not found" });
        }
        const pi = bidR.rows[0]?.payment_intent_id;
        if (pi) {
            try {
                await stripe.paymentIntents.cancel(pi);
            } catch {
            }
        }

        await client.query(
            `UPDATE auction_bids
             SET status = 'rejected', updated_at = now()
             WHERE id = $1`,
            [bidId]
        );

        await client.query("COMMIT");
        return res.json({ ok: true, rejected_bid_id: bidId });
    } catch (e) {
        await client.query("ROLLBACK");
        return res.status(500).json({ ok: false, error: String(e) });
    } finally {
        client.release();
    }
});

export default router;
