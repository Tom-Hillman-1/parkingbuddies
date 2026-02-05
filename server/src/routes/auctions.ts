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

async function finalizeAuctionIfEnded(spotId: string) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const spotR = await client.query(
            `SELECT id, owner_user_id, mode, auction_end
             FROM parking_spots
             WHERE id = $1`,
            [spotId]
        );
        if (!spotR.rowCount) {
            await client.query("ROLLBACK");
            return;
        }

        const spot = spotR.rows[0] as any;
        if (spot.mode !== "auction" || !spot.auction_end) {
            await client.query("ROLLBACK");
            return;
        }

        const ended = new Date(spot.auction_end) <= new Date();
        if (!ended) {
            await client.query("ROLLBACK");
            return;
        }

        const winnerExists = await client.query(
            `SELECT 1 FROM auction_bids
             WHERE parking_spot_id = $1 AND status IN ('accepted','won')
             LIMIT 1`,
            [spotId]
        );
        if (winnerExists.rowCount) {
            await client.query("ROLLBACK");
            return;
        }

        const topR = await client.query(
            `SELECT id FROM auction_bids
             WHERE parking_spot_id = $1
             ORDER BY amount_gbp DESC, created_at ASC
             LIMIT 1`,
            [spotId]
        );
        if (!topR.rowCount) {
            await client.query("ROLLBACK");
            return;
        }

        const topId = topR.rows[0].id;

        await client.query(
            `UPDATE auction_bids
             SET status = 'won', updated_at = now()
             WHERE id = $1`,
            [topId]
        );

        await client.query(
            `UPDATE auction_bids
             SET status = 'lost', updated_at = now()
             WHERE parking_spot_id = $1 AND id <> $2 AND status IN ('pending','outbid','rejected')`,
            [spotId, topId]
        );

        await client.query("COMMIT");
    } catch {
        await client.query("ROLLBACK");
    } finally {
        client.release();
    }
}

/**
 * GET /auctions/:spotId
 * Public: returns auction summary.
 * Auth: includes bidder info if owner.
 */
router.get("/:spotId", async (req, res) => {
    const spotId = req.params.spotId;

    try {
        await finalizeAuctionIfEnded(spotId);

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

        const highestR = await pool.query(
            `SELECT amount_gbp FROM auction_bids
             WHERE parking_spot_id = $1
             ORDER BY amount_gbp DESC, created_at ASC
             LIMIT 1`,
            [spotId]
        );
        const highest = highestR.rowCount ? toMoney(highestR.rows[0].amount_gbp) : 0;

        const auction: any = {
            highest_bid_gbp: highest,
            auction_end: spot.auction_end,
            auction_start_price_gbp: spot.auction_start_price_gbp,
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
                        `SELECT b.id, b.amount_gbp, b.status, u.name AS bidder_name, u.email AS bidder_email
                         FROM auction_bids b
                         JOIN users u ON u.id = b.bidder_user_id
                         WHERE b.parking_spot_id = $1
                         ORDER BY b.amount_gbp DESC, b.created_at ASC`,
                        [spotId]
                    );
                    auction.bids = bidsR.rows;
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
 * Returns the authenticated user's latest bid status for this auction.
 */
router.get("/:spotId/me", requireAuth, async (req: AuthRequest, res) => {
    const spotId = req.params.spotId;
    try {
        await finalizeAuctionIfEnded(spotId);

        const bidR = await pool.query(
            `SELECT amount_gbp, status
             FROM auction_bids
             WHERE parking_spot_id = $1 AND bidder_user_id = $2
             ORDER BY created_at DESC
             LIMIT 1`,
            [spotId, req.userId]
        );

        if (!bidR.rowCount) {
            return res.json({ ok: true, me: null });
        }

        return res.json({ ok: true, me: bidR.rows[0] });
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
        await finalizeAuctionIfEnded(spotId);

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
            `SELECT b.id, b.amount_gbp, b.status, u.name AS bidder_name, u.email AS bidder_email
             FROM auction_bids b
             JOIN users u ON u.id = b.bidder_user_id
             WHERE b.parking_spot_id = $1
             ORDER BY b.amount_gbp DESC, b.created_at ASC`,
            [spotId]
        );

        const highest = bidsR.rowCount ? toMoney(bidsR.rows[0].amount_gbp) : 0;

        return res.json({
            ok: true,
            auction: {
                highest_bid_gbp: highest,
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
        const r = await pool.query(
            `SELECT
                 b.id,
                 b.parking_spot_id,
                 b.amount_gbp,
                 b.status,
                 b.created_at,
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
        const r = await pool.query(
            `SELECT b.id, b.parking_spot_id, b.amount_gbp, b.status, b.created_at, ps.title AS spot_title
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
 * POST /auctions/:spotId/bid
 * Body: { amount_gbp }
 */
router.post("/:spotId/bid", requireAuth, async (req: AuthRequest, res) => {
    const spotId = req.params.spotId;
    const amount = toMoney(req.body?.amount_gbp);
    const paymentIntentId = req.body?.payment_intent_id;

    if (!amount || amount <= 0) {
        return res.status(400).json({ ok: false, error: "Invalid bid amount" });
    }
    if (typeof paymentIntentId !== "string" || !paymentIntentId.trim()) {
        return res.status(400).json({ ok: false, error: "payment_intent_id is required" });
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const spotR = await client.query(
            `SELECT id, owner_user_id, mode, auction_end, auction_start_price_gbp
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

        const startPrice = toMoney(spot.auction_start_price_gbp);
        if (amount < startPrice) {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: `Bid must be at least £${startPrice.toFixed(2)}` });
        }

        const highestR = await client.query(
            `SELECT amount_gbp FROM auction_bids
             WHERE parking_spot_id = $1
             ORDER BY amount_gbp DESC, created_at ASC
             LIMIT 1`,
            [spotId]
        );
        const highest = highestR.rowCount ? toMoney(highestR.rows[0].amount_gbp) : 0;
        if (amount <= highest) {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: "Bid must be higher than current highest" });
        }

        // verify payment intent (manual capture)
        const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
        if (intent.metadata?.user_id !== req.userId || intent.metadata?.spot_id !== spotId) {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: "Payment intent does not match this bid" });
        }
        const amountPence = Math.round(amount * 100);
        if (intent.amount !== amountPence || intent.currency !== "gbp") {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: "Payment amount mismatch" });
        }
        if (intent.status !== "requires_capture") {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: "Card authorization not completed" });
        }

        await client.query(
            `INSERT INTO auction_bids (parking_spot_id, bidder_user_id, amount_gbp, payment_intent_id)
             VALUES ($1,$2,$3,$4)`,
            [spotId, req.userId, amount.toFixed(2), paymentIntentId]
        );

        await client.query(
            `UPDATE auction_bids
             SET status = 'outbid', updated_at = now()
             WHERE parking_spot_id = $1 AND status = 'pending' AND amount_gbp < $2`,
            [spotId, amount.toFixed(2)]
        );

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
         ORDER BY amount_gbp DESC, created_at ASC
         LIMIT 1`,
        [spotId]
    );
    const highest = summary.rowCount ? toMoney(summary.rows[0].amount_gbp) : 0;
    return res.json({ ok: true, auction: { highest_bid_gbp: highest } });
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
            return res.status(403).json({ ok: false, error: "Only the owner can accept a bid" });
        }

        const bidInfoR = await client.query(
            `SELECT id, bidder_user_id, amount_gbp, payment_intent_id
             FROM auction_bids
             WHERE id = $1 AND parking_spot_id = $2`,
            [bidId, spotId]
        );
        if (!bidInfoR.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ ok: false, error: "Bid not found" });
        }

        const bidInfo = bidInfoR.rows[0];
        if (!bidInfo.payment_intent_id) {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: "Bid has no payment authorization" });
        }

        // capture payment
        await stripe.paymentIntents.capture(bidInfo.payment_intent_id);

        await client.query(
            `UPDATE auction_bids
             SET status = 'accepted', updated_at = now()
             WHERE id = $1`,
            [bidId]
        );

        await client.query(
            `UPDATE auction_bids
             SET status = 'rejected', updated_at = now()
             WHERE parking_spot_id = $1 AND id <> $2 AND status IN ('pending','outbid')`,
            [spotId, bidId]
        );

        // create booking for full availability window
        const spotDetailsR = await client.query(
            `SELECT availability_json
             FROM parking_spots
             WHERE id = $1`,
            [spotId]
        );
        const av = spotDetailsR.rows[0]?.availability_json as any;
        const dateFrom = av?.date_from;
        const dateTo = av?.date_to;
        if (!dateFrom || !dateTo) {
            await client.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: "Auction listing must have a date range" });
        }
        const start = new Date(`${dateFrom}T00:00:00Z`).toISOString();
        const end = new Date(`${dateTo}T23:59:59Z`).toISOString();

        await client.query(
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
             VALUES ($1,$2,$3,$4,'confirmed','money',$5,0)`,
            [spotId, bidInfo.bidder_user_id, start, end, bidInfo.amount_gbp]
        );

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
