import { Router } from "express";
import { pool } from "../db";
import { requireAuth, AuthRequest } from "../middleware/auth";
import jwt from "jsonwebtoken";
import { stripe } from "../stripe";
import { countOverlappingBookings, isSlotAllowed, remainingMinutes } from "../lib/availability";
import { calcAuctionUnits, type PriceUnit, toMoney } from "../lib/shared";

const router = Router();

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
    }
}

function isValidDurationMinutes(minutes: number) {
    if (!Number.isFinite(minutes) || minutes <= 0) return false;
    if (minutes <= 12 * 60) return minutes % 15 === 0;
    if (minutes <= 72 * 60) return minutes % 60 === 0;
    if (minutes <= 30 * 24 * 60) return minutes % (24 * 60) === 0;
    return false;
}

const AUCTION_SPOT_MUTATION_SELECT =
    `SELECT id, owner_user_id, mode, price_unit, auction_start_price_gbp, allow_points, points_cost, availability_json, availability_type, available_days, daily_start, daily_end, capacity_total ` +
    `FROM parking_spots WHERE id = $1`;

function normalizeAuctionUnit(rawUnit: unknown): PriceUnit {
    return rawUnit === "day" || rawUnit === "week" ? rawUnit : "hour";
}

async function loadAuctionSpot(client: any, spotId: string) {
    const spotR = await client.query(AUCTION_SPOT_MUTATION_SELECT, [spotId]);
    if (!spotR.rowCount) return null;
    return spotR.rows[0] as any;
}

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
             ORDER BY created_at DESC
             LIMIT 5`,
            [spotId]
        );

        const bookingWindowsR = await pool.query(
            `SELECT start_time, end_time
             FROM bookings
             WHERE parking_spot_id = $1
               AND status IN ('confirmed', 'pending')
               AND start_time IS NOT NULL
               AND end_time IS NOT NULL`,
            [spotId]
        );
        const occupied = bookingWindowsR.rows.map((b: any) => ({ start: new Date(b.start_time), end: new Date(b.end_time) }));
        const remaining = remainingMinutes(spot, occupied);
        const soldOut = remaining < 16;

        const auction: any = {
            auction_end: spot.auction_end,
            auction_start_price_gbp: spot.auction_start_price_gbp,
            pending_bids: pendingR.rows,
            approved_bids: approvedR.rows,
            sold_out: soldOut,
        };
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
                         ORDER BY b.created_at DESC
                         LIMIT 20`,
                        [spotId]
                    );
                    auction.pending_bids = bidsR.rows;
                }
            } catch {
            }
        }

        return res.json({ ok: true, auction });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

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
             ORDER BY b.created_at DESC`,
            [req.userId]
        );

        return res.json({ ok: true, bids: r.rows });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

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
    const requestedStart = new Date(startRaw);
    const requestedEnd = new Date(endRaw);
    if (Number.isNaN(requestedStart.getTime()) || Number.isNaN(requestedEnd.getTime()) || !(requestedStart < requestedEnd)) {
        return res.status(400).json({ ok: false, error: "Invalid start/end time" });
    }

    const client = await pool.connect();
    let bidId: string | null = null;
    try {
        await client.query("BEGIN");
        await ensureAuctionBidSchema();
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [spotId]);

        const spot = await loadAuctionSpot(client, spotId);
        if (!spot) {
            await client.query("ROLLBACK");
            return res.status(404).json({ ok: false, error: "Listing not found" });
        }
        if (spot.mode !== "auction") {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: "Listing is not an auction" });
        }
        if (spot.owner_user_id === req.userId) {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: "Owners cannot bid on their own listings" });
        }

        const unit = normalizeAuctionUnit(spot.price_unit);
        const start = requestedStart;
        const end = requestedEnd;
        const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
        const maxEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        if (end > maxEnd || !isValidDurationMinutes(minutes)) {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: "Selected slot exceeds the allowed booking window." });
        }

        if (!isSlotAllowed(spot, start, end)) {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: "Requested slot is outside listing availability" });
        }

        const capacity = Math.max(1, Number(spot.capacity_total ?? 1));
        const overlapCount = await countOverlappingBookings(client, spotId, start.toISOString(), end.toISOString());
        if (overlapCount >= capacity) {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: "Selected slot is no longer available" });
        }

        if (payMethod === "money") {
            const startPrice = toMoney(spot.auction_start_price_gbp);
            if (startPrice < 0.1) {
                await client.query("ROLLBACK");
                return res.status(400).json({ ok: false, error: "This auction does not accept money bids" });
            }
            const units = calcAuctionUnits(minutes, unit);
            const minTotal = Math.round(startPrice * units * 100) / 100;
            if (amount < minTotal) {
                await client.query("ROLLBACK");
                return res.status(400).json({ ok: false, error: `Bid must be at least GBP ${minTotal.toFixed(2)} for this ${unit} slot` });
            }
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
                return res.status(400).json({ ok: false, error: `Bid must be at least ${minPoints} pts per ${unit}` });
            }

            const units = calcAuctionUnits(minutes, unit);
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

    return res.json({ ok: true, bid_id: bidId });
});

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
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [spotId]);

        const spot = await loadAuctionSpot(client, spotId);
        if (!spot) {
            await client.query("ROLLBACK");
            return res.status(404).json({ ok: false, error: "Listing not found" });
        }
        if (spot.mode !== "auction") {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: "Listing is not an auction" });
        }
        if (spot.owner_user_id !== req.userId) {
            await client.query("ROLLBACK");
            return res.status(403).json({ ok: false, error: "Only the owner can accept a bid" });
        }
        const unit = normalizeAuctionUnit(spot.price_unit);

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

        const capacity = Math.max(1, Number(spot.capacity_total ?? 1));
        const overlapCount = await countOverlappingBookings(client, spotId, start.toISOString(), end.toISOString());
        if (overlapCount >= capacity) {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: "Slot already full for this time range" });
        }

        if ((bidInfo.pay_method ?? "money") === "money") {
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
            const units = calcAuctionUnits(minutes, unit);
            const perUnitPoints = Number(bidInfo.amount_points ?? 0);
            if (!Number.isFinite(perUnitPoints) || perUnitPoints <= 0) {
                await client.query("ROLLBACK");
                return res.status(400).json({ ok: false, error: "Invalid points bid" });
            }
            const totalPoints = Math.ceil(perUnitPoints * units);

            const deductedR = await client.query(
                `UPDATE users
                 SET points_balance = points_balance - $1, updated_at = now()
                 WHERE id = $2
                   AND points_balance >= $1
                 RETURNING points_balance`,
                [totalPoints, bidInfo.bidder_user_id]
            );
            if (!deductedR.rowCount) {
                const balanceR = await client.query(`SELECT points_balance FROM users WHERE id = $1`, [
                    bidInfo.bidder_user_id,
                ]);
                if (!balanceR.rowCount) {
                    await client.query("ROLLBACK");
                    return res.status(404).json({ ok: false, error: "Bidder not found" });
                }
                await client.query("ROLLBACK");
                return res.status(400).json({
                    ok: false,
                    error: `Bidder does not have enough points (${totalPoints} required)`,
                });
            }
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


