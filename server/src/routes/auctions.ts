import { Router } from "express";
import { pool } from "../db";
import { requireAuth, AuthRequest } from "../middleware/auth";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { stripe } from "../stripe";
import { countOverlappingBookings, isSlotAllowed, remainingMinutes } from "../lib/availability";
import { calcAuctionUnits, type PriceUnit, toMoney } from "../lib/shared";
import { z } from "zod";
import { parseWithSchema } from "../lib/validation";

const router = Router();
const PENDING_BOOKING_HOLD_MINUTES = 30;
const DEMO_MONEY_AUTH_ENABLED = ["1", "true", "yes", "on"].includes(
    String(process.env.DEMO_BYPASS_CONNECT ?? "").toLowerCase()
);
const DEMO_AUCTION_AUTH_PREFIX = "demo_auction_auth_";

const spotIdParamsSchema = z.object({
    spotId: z.string().uuid("spotId must be a valid listing ID"),
});

const createBidBodySchema = z.object({
    pay_method: z.enum(["money", "points"]).optional(),
    amount_gbp: z.coerce.number().optional(),
    amount_points: z.coerce.number().optional(),
    payment_intent_id: z.string().trim().regex(/^pi_[A-Za-z0-9_]+$/, "payment_intent_id must be a Stripe PaymentIntent ID").optional(),
    demo_authorization: z.coerce.boolean().optional(),
    start_time: z.string().trim().min(1),
    end_time: z.string().trim().min(1),
});

const bidActionBodySchema = z.object({
    bid_id: z.string().uuid("bid_id must be a valid bid ID"),
});

const bidIdParamsSchema = z.object({
    bidId: z.string().uuid("bidId must be a valid bid ID"),
});

function isValidDurationMinutes(minutes: number) {
    if (!Number.isFinite(minutes) || minutes <= 0) return false;
    if (minutes <= 12 * 60) return minutes % 15 === 0;
    if (minutes <= 72 * 60) return minutes % 60 === 0;
    if (minutes <= 30 * 24 * 60) return minutes % (24 * 60) === 0;
    return false;
}

const AUCTION_SPOT_MUTATION_SELECT =
    `SELECT id, owner_user_id, mode, price_unit, auction_start_price_gbp, allow_points, points_cost, availability_json, capacity_total ` +
    `FROM parking_spots WHERE id = $1`;

function normalizeAuctionUnit(rawUnit: unknown): PriceUnit {
    return rawUnit === "day" || rawUnit === "week" ? rawUnit : "hour";
}

function isDemoAuctionAuthorizationId(value: unknown) {
    return typeof value === "string" && value.startsWith(DEMO_AUCTION_AUTH_PREFIX);
}

async function cancelPaymentIntentSilently(paymentIntentId: string | null | undefined) {
    if (!paymentIntentId || isDemoAuctionAuthorizationId(paymentIntentId)) return;
    try {
        await stripe.paymentIntents.cancel(paymentIntentId);
    } catch {
    }
}

async function loadAuctionSpot(client: any, spotId: string) {
    const spotR = await client.query(AUCTION_SPOT_MUTATION_SELECT, [spotId]);
    if (!spotR.rowCount) return null;
    return spotR.rows[0] as any;
}

async function updateAcceptedMoneyBidFailureState(
    bidId: string,
    bookingId: string,
    paymentStatus: "failed" | "refunded"
) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await client.query(
            `UPDATE auction_bids
             SET status = 'rejected', updated_at = now()
             WHERE id = $1`,
            [bidId]
        );
        await client.query(
            `UPDATE bookings
             SET status = 'cancelled', updated_at = now()
             WHERE id = $1`,
            [bookingId]
        );
        await client.query(
            `UPDATE payments
             SET status = $2,
                 updated_at = now()
             WHERE booking_id = $1`,
            [bookingId, paymentStatus]
        );
        await client.query("COMMIT");
    } catch (e) {
        await client.query("ROLLBACK");
        throw e;
    } finally {
        client.release();
    }
}

router.get("/owner/bids", requireAuth, async (req: AuthRequest, res) => {
    try {
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
                 ps.price_unit,
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
        const r = await pool.query(
            `SELECT b.id, b.parking_spot_id, b.amount_gbp, b.amount_points, b.pay_method, b.status, b.created_at, b.start_time, b.end_time, ps.price_unit, ps.title AS spot_title
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
    const parsedParams = parseWithSchema(bidIdParamsSchema, req.params ?? {}, res, "auction_bid_get");
    if (!parsedParams.ok) return;
    const bidId = parsedParams.data.bidId;
    try {
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
                    ps.price_unit AS price_unit,
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
                price_unit: row.price_unit ?? "hour",
                booking_id: bookingId,
                payment_status: paymentStatus,
            },
        });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

router.get("/:spotId", async (req, res) => {
    const parsedParams = parseWithSchema(spotIdParamsSchema, req.params ?? {}, res, "auction_get");
    if (!parsedParams.ok) return;
    const spotId = parsedParams.data.spotId;

    try {
        const spotR = await pool.query(
            `SELECT id, owner_user_id, mode, auction_end, auction_start_price_gbp, availability_json, capacity_total
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
               AND (
                   status = 'confirmed'
                   OR (status = 'pending' AND created_at >= now() - ($2 * interval '1 minute'))
               )
               AND start_time IS NOT NULL
               AND end_time IS NOT NULL`,
            [spotId, PENDING_BOOKING_HOLD_MINUTES]
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

router.post("/:spotId/bid", requireAuth, async (req: AuthRequest, res) => {
    const parsedParams = parseWithSchema(spotIdParamsSchema, req.params ?? {}, res, "auction_bid");
    if (!parsedParams.ok) return;
    const parsedBody = parseWithSchema(createBidBodySchema, req.body ?? {}, res, "auction_bid");
    if (!parsedBody.ok) return;

    const spotId = parsedParams.data.spotId;
    const payMethod = parsedBody.data.pay_method === "points" ? "points" : "money";
    const amount = toMoney(parsedBody.data.amount_gbp);
    const amountPoints = Number(parsedBody.data.amount_points);
    const paymentIntentId = parsedBody.data.payment_intent_id;
    const paymentIntentIdValue = typeof paymentIntentId === "string" ? paymentIntentId : "";
    const wantsDemoAuthorization = parsedBody.data.demo_authorization === true;
    const startRaw = parsedBody.data.start_time;
    const endRaw = parsedBody.data.end_time;

    if (payMethod === "money") {
        if (!amount || amount <= 0) {
            return res.status(400).json({ ok: false, error: "Invalid bid amount" });
        }
        if (!paymentIntentIdValue.trim() && !(wantsDemoAuthorization && DEMO_MONEY_AUTH_ENABLED)) {
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
    const rollbackWith = async (status: number, error: string, cancelIntent = false) => {
        await client.query("ROLLBACK");
        if (cancelIntent) {
            await cancelPaymentIntentSilently(paymentIntentIdValue);
        }
        return res.status(status).json({ ok: false, error });
    };
    try {
        await client.query("BEGIN");
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [spotId]);

        const spot = await loadAuctionSpot(client, spotId);
        if (!spot) {
            return rollbackWith(404, "Listing not found", payMethod === "money");
        }
        if (spot.mode !== "auction") {
            return rollbackWith(400, "Listing is not an auction", payMethod === "money");
        }
        if (spot.owner_user_id === req.userId) {
            return rollbackWith(400, "Owners cannot bid on their own listings", payMethod === "money");
        }

        const unit = normalizeAuctionUnit(spot.price_unit);
        const start = requestedStart;
        const end = requestedEnd;
        const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
        const maxEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        if (end > maxEnd || !isValidDurationMinutes(minutes)) {
            return rollbackWith(400, "Selected slot exceeds the allowed booking window.", payMethod === "money");
        }

        if (!isSlotAllowed(spot, start, end)) {
            return rollbackWith(400, "Requested slot is outside listing availability", payMethod === "money");
        }

        const capacity = Math.max(1, Number(spot.capacity_total ?? 1));
        const overlapCount = await countOverlappingBookings(client, spotId, start.toISOString(), end.toISOString());
        if (overlapCount >= capacity) {
            return rollbackWith(400, "Selected slot is no longer available", payMethod === "money");
        }

        if (payMethod === "money") {
            const startPrice = toMoney(spot.auction_start_price_gbp);
            if (startPrice < 0.1) {
                return rollbackWith(400, "This auction does not accept money bids", true);
            }
            const units = calcAuctionUnits(minutes, unit);
            const minTotal = Math.round(startPrice * units * 100) / 100;
            if (amount < minTotal) {
                return rollbackWith(400, `Bid must be at least GBP ${minTotal.toFixed(2)} for this ${unit} slot`, true);
            }
            const authorizationRef =
                wantsDemoAuthorization && DEMO_MONEY_AUTH_ENABLED
                    ? `${DEMO_AUCTION_AUTH_PREFIX}${randomUUID().replace(/-/g, "")}`
                    : paymentIntentIdValue;

            if (!isDemoAuctionAuthorizationId(authorizationRef)) {
                const intent = await stripe.paymentIntents.retrieve(paymentIntentIdValue);
                if (
                    intent.metadata?.user_id !== req.userId ||
                    intent.metadata?.spot_id !== spotId ||
                    intent.metadata?.owner_user_id !== spot.owner_user_id
                ) {
                    return rollbackWith(400, "Payment intent does not match this bid", true);
                }
                const amountPence = Math.round(amount * 100);
                if (intent.amount !== amountPence || intent.currency !== "gbp") {
                    return rollbackWith(400, "Payment amount mismatch", true);
                }
                if (intent.capture_method !== "manual") {
                    return rollbackWith(400, "Invalid auction authorization type", true);
                }
                if (intent.status !== "requires_capture") {
                    return rollbackWith(400, "Card authorization not completed", true);
                }
            }

            const insertR = await client.query(
                `INSERT INTO auction_bids (parking_spot_id, bidder_user_id, amount_gbp, payment_intent_id, start_time, end_time, status, pay_method)
                 VALUES ($1,$2,$3,$4,$5,$6,'pending','money')
                 RETURNING id`,
                [spotId, req.userId, amount.toFixed(2), authorizationRef, start.toISOString(), end.toISOString()]
            );
            bidId = insertR.rows[0]?.id ?? null;
        } else {
            if (!spot.allow_points) {
                return rollbackWith(400, "This auction does not accept points");
            }
            const minPoints = Number(spot.points_cost ?? 0);
            if (!Number.isFinite(minPoints) || minPoints <= 0) {
                return rollbackWith(400, "Invalid points cost for this listing");
            }
            if (amountPoints < minPoints) {
                return rollbackWith(400, `Bid must be at least ${minPoints} pts per ${unit}`);
            }

            const units = calcAuctionUnits(minutes, unit);
            const totalPoints = Math.ceil(amountPoints * units);
            const userR = await client.query(
                `SELECT points_balance FROM users WHERE id = $1`,
                [req.userId]
            );
            if (!userR.rowCount) {
                return rollbackWith(404, "User not found");
            }
            const balance = Number(userR.rows[0].points_balance ?? 0);
            if (balance < totalPoints) {
                return rollbackWith(400, `Not enough points (${totalPoints} required)`);
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
        if (payMethod === "money") {
            await cancelPaymentIntentSilently(paymentIntentIdValue);
        }
        return res.status(500).json({ ok: false, error: String(e) });
    } finally {
        client.release();
    }

    return res.json({ ok: true, bid_id: bidId });
});

router.post("/:spotId/accept", requireAuth, async (req: AuthRequest, res) => {
    const parsedParams = parseWithSchema(spotIdParamsSchema, req.params ?? {}, res, "auction_accept");
    if (!parsedParams.ok) return;
    const parsedBody = parseWithSchema(bidActionBodySchema, req.body ?? {}, res, "auction_accept");
    if (!parsedBody.ok) return;
    const spotId = parsedParams.data.spotId;
    const bidId = parsedBody.data.bid_id;

    const client = await pool.connect();
    let acceptedBookingId: string | null = null;
    let acceptedPaymentIntentId: string | null = null;
    try {
        await client.query("BEGIN");
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
            acceptedPaymentIntentId = bidInfo.payment_intent_id;
            const demoAuthorization = isDemoAuctionAuthorizationId(acceptedPaymentIntentId);

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
                    total_points,
                    payment_provider_ref
                )
                 VALUES ($1,$2,$3,$4,'pending','money',$5,0,$6)
                 RETURNING id`,
                [spotId, bidInfo.bidder_user_id, start.toISOString(), end.toISOString(), bidInfo.amount_gbp, acceptedPaymentIntentId]
            );

            acceptedBookingId = bookingR.rows[0]?.id ?? null;
            if (!acceptedBookingId) {
                await client.query("ROLLBACK");
                return res.status(500).json({ ok: false, error: "Failed to reserve booking for accepted bid" });
            }

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
                 VALUES ($1, $2, $3, 'pending', $4, now(), now())`,
                [acceptedBookingId, demoAuthorization ? "demo" : "stripe", acceptedPaymentIntentId, bidInfo.amount_gbp]
            );
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

    if (acceptedBookingId && acceptedPaymentIntentId) {
        if (!isDemoAuctionAuthorizationId(acceptedPaymentIntentId)) {
            try {
                await stripe.paymentIntents.capture(acceptedPaymentIntentId);
            } catch (captureError: unknown) {
                try {
                    await updateAcceptedMoneyBidFailureState(bidId, acceptedBookingId, "failed");
                } catch {
                }
                return res.status(400).json({
                    ok: false,
                    error: `Card capture failed after acceptance: ${String(captureError)}`,
                });
            }
        }

        const finalizeClient = await pool.connect();
        try {
            await finalizeClient.query("BEGIN");
            await finalizeClient.query(
                `UPDATE bookings
                 SET status = 'confirmed', updated_at = now()
                 WHERE id = $1`,
                [acceptedBookingId]
            );
            await finalizeClient.query(
                `UPDATE payments
                 SET status = 'succeeded',
                     updated_at = now()
                 WHERE booking_id = $1`,
                [acceptedBookingId]
            );
            await finalizeClient.query("COMMIT");
        } catch (finalizeError: unknown) {
            await finalizeClient.query("ROLLBACK");
            try {
                await stripe.refunds.create({ payment_intent: acceptedPaymentIntentId });
                await updateAcceptedMoneyBidFailureState(bidId, acceptedBookingId, "refunded");
            } catch {
            }
            return res.status(500).json({
                ok: false,
                error: `Booking finalization failed after capture: ${String(finalizeError)}`,
            });
        } finally {
            finalizeClient.release();
        }
    }

    return res.json({ ok: true, auction: { accepted_bid_id: bidId, booking_id: acceptedBookingId } });
});

router.post("/:spotId/reject", requireAuth, async (req: AuthRequest, res) => {
    const parsedParams = parseWithSchema(spotIdParamsSchema, req.params ?? {}, res, "auction_reject");
    if (!parsedParams.ok) return;
    const parsedBody = parseWithSchema(bidActionBodySchema, req.body ?? {}, res, "auction_reject");
    if (!parsedBody.ok) return;
    const spotId = parsedParams.data.spotId;
    const bidId = parsedBody.data.bid_id;

    const client = await pool.connect();
    let paymentIntentToCancel: string | null = null;
    try {
        await client.query("BEGIN");
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [spotId]);

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
            `SELECT id, payment_intent_id, status FROM auction_bids
             WHERE id = $1 AND parking_spot_id = $2`,
            [bidId, spotId]
        );
        if (!bidR.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ ok: false, error: "Bid not found" });
        }
        const bidStatus = String(bidR.rows[0]?.status ?? "pending");
        if (bidStatus !== "pending") {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: "Only pending bids can be rejected" });
        }
        paymentIntentToCancel = bidR.rows[0]?.payment_intent_id ?? null;

        await client.query(
            `UPDATE auction_bids
             SET status = 'rejected', updated_at = now()
             WHERE id = $1`,
            [bidId]
        );

        await client.query("COMMIT");
    } catch (e) {
        await client.query("ROLLBACK");
        return res.status(500).json({ ok: false, error: String(e) });
    } finally {
        client.release();
    }

    if (paymentIntentToCancel) {
        await cancelPaymentIntentSilently(paymentIntentToCancel);
    }
    return res.json({ ok: true, rejected_bid_id: bidId });
});

export default router;


