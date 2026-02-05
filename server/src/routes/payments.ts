import { Router } from "express";
import { pool } from "../db";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { stripe } from "../stripe";

const router = Router();

/**
 * POST /payments/create-intent
 * Body: { booking_id: string }
 * Creates a Stripe PaymentIntent and stores it in the payments table.
 */
router.post("/create-intent", requireAuth, async (req: AuthRequest, res) => {
    const { booking_id, provider } = req.body ?? {};

    if (typeof booking_id !== "string") {
        return res.status(400).json({ ok: false, error: "booking_id is required" });
    }

    try {
        // Booking must belong to the authenticated driver
        const bookingR = await pool.query(
            `SELECT b.id, b.status, b.driver_user_id, b.total_price_gbp
       FROM bookings b
       JOIN parking_spots ps ON ps.id = b.parking_spot_id
       WHERE b.id = $1 AND b.driver_user_id = $2`,
            [booking_id, req.userId]
        );

        if (!bookingR.rowCount) {
            return res.status(404).json({ ok: false, error: "Booking not found" });
        }

        const booking = bookingR.rows[0];

        // Only pending money bookings should be payable (minimal + logical)
        if (booking.status !== "pending") {
            return res.status(400).json({ ok: false, error: "Booking is not payable" });
        }

        const amountGbp = Number(booking.total_price_gbp ?? 0);
        if (!Number.isFinite(amountGbp) || amountGbp <= 0) {
            return res.status(400).json({ ok: false, error: "Invalid booking amount" });
        }

        const chosenProvider = typeof provider === "string" ? provider : "stripe";

        if (chosenProvider === "stripe") {
            const amountPence = Math.round(amountGbp * 100);
            const intent = await stripe.paymentIntents.create({
                amount: amountPence,
                currency: "gbp",
                automatic_payment_methods: { enabled: true },
                metadata: {
                    booking_id,
                    user_id: req.userId,
                },
            });

            await pool.query(
                `INSERT INTO payments (
           booking_id,
           provider,
           provider_ref,
           status,
           amount_gbp
         )
         VALUES ($1,'stripe',$2,'pending',$3)`,
                [booking_id, intent.id, amountGbp]
            );

            return res.json({
                ok: true,
                client_secret: intent.client_secret,
                payment_intent_id: intent.id,
            });
        }

        return res.status(400).json({ ok: false, error: "Unsupported provider" });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

/**
 * POST /payments/auction-intent
 * Body: { spot_id: string, amount_gbp: number }
 * Creates a manual-capture PaymentIntent for auction bids.
 */
router.post("/auction-intent", requireAuth, async (req: AuthRequest, res) => {
    const { spot_id, amount_gbp } = req.body ?? {};
    if (typeof spot_id !== "string") {
        return res.status(400).json({ ok: false, error: "spot_id is required" });
    }
    const amount = Number(amount_gbp ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ ok: false, error: "amount_gbp is invalid" });
    }

    try {
        const amountPence = Math.round(amount * 100);
        const intent = await stripe.paymentIntents.create({
            amount: amountPence,
            currency: "gbp",
            capture_method: "manual",
            automatic_payment_methods: { enabled: true },
            metadata: {
                spot_id,
                user_id: req.userId,
                type: "auction_bid",
            },
        });

        return res.json({
            ok: true,
            client_secret: intent.client_secret,
            payment_intent_id: intent.id,
        });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

/**
 * GET /payments/me
 * Returns payment history for the authenticated driver.
 */
router.get("/me", requireAuth, async (req: AuthRequest, res) => {
    try {
        const r = await pool.query(
            `SELECT
                 p.id,
                 p.booking_id,
                 p.provider,
                 p.status,
                 p.amount_gbp,
                 p.created_at,
                 b.start_time,
                 b.end_time,
                 ps.title AS spot_title,
                 ps.address_text AS spot_address
             FROM payments p
                      JOIN bookings b ON b.id = p.booking_id
                      JOIN parking_spots ps ON ps.id = b.parking_spot_id
             WHERE b.driver_user_id = $1
             ORDER BY p.created_at DESC`,
            [req.userId]
        );

        return res.json({ ok: true, payments: r.rows });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

export default router;
