import { Router } from "express";
import type { Request, Response } from "express";
import type { PoolClient } from "pg";
import type Stripe from "stripe";
import { pool } from "../db";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { stripe } from "../stripe";
import { moneyBookingRewardPoints, toMoney } from "../lib/shared";
import { z } from "zod";
import { parseWithSchema } from "../lib/validation";

const router = Router();

const STRIPE_CONNECT_COUNTRY = process.env.STRIPE_CONNECT_COUNTRY ?? "GB";
const DEMO_PAYOUTS_ENABLED = ["1", "true", "yes", "on"].includes(
    String(process.env.DEMO_BYPASS_CONNECT ?? "").toLowerCase()
);
const DEMO_CONNECT_ACCOUNT_PREFIX = "acct_demo_";

// credit: request schema validation pattern adapted from Zod docs (https://zod.dev)
const connectOnboardBodySchema = z.object({
    mode: z.enum(["stripe", "demo"]).optional(),
});

const checkoutSessionBodySchema = z.object({
    booking_id: z.string().trim().min(1),
});

const auctionIntentBodySchema = z.object({
    spot_id: z.string().trim().min(1),
    amount_gbp: z.coerce.number(),
});

const bookingReceiptParamsSchema = z.object({
    bookingId: z.string().trim().min(1),
});

const bookingReceiptQuerySchema = z.object({
    session_id: z.string().trim().min(1).optional(),
});

type UserConnectRow = {
    id: string;
    email: string;
    stripe_account_id: string | null;
    stripe_charges_enabled: boolean;
    stripe_payouts_enabled: boolean;
    stripe_details_submitted: boolean;
};

type ConnectStatus = {
    account_id: string | null;
    charges_enabled: boolean;
    payouts_enabled: boolean;
    details_submitted: boolean;
    onboarding_complete: boolean;
    dashboard_enabled: boolean;
    demo_bypass: boolean;
    demo_available: boolean;
};

type StripeReceiptDetails = {
    payment_intent_id: string;
    payment_intent_status: Stripe.PaymentIntent.Status;
    charge_id: string | null;
    receipt_url: string | null;
    receipt_email: string | null;
    amount_received_gbp: number;
};
type OwnerConnectResult =
    | { ok: true; ownerAccountUsable: string | null; ownerConnectStatus: ConnectStatus }
    | { ok: false; error: string };

function frontendBaseUrl() {
    return process.env.FRONTEND_URL ?? process.env.CLIENT_URL ?? "http://localhost:5173";
}

function demoConnectStatus(accountId: string | null = null): ConnectStatus {
    return {
        account_id: accountId,
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
        onboarding_complete: true,
        dashboard_enabled: false,
        demo_bypass: true,
        demo_available: DEMO_PAYOUTS_ENABLED,
    };
}

function isDemoConnectAccountId(accountId: string | null | undefined) {
    return typeof accountId === "string" && accountId.startsWith(DEMO_CONNECT_ACCOUNT_PREFIX);
}

function disconnectedConnectStatus(): ConnectStatus {
    return {
        account_id: null,
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: false,
        onboarding_complete: false,
        dashboard_enabled: false,
        demo_bypass: false,
        demo_available: DEMO_PAYOUTS_ENABLED,
    };
}

function requireUserId(req: AuthRequest, res: Response) {
    if (!req.userId) {
        res.status(401).json({ ok: false, error: "Unauthorized" });
        return null;
    }
    return req.userId;
}

function asNonEmptyString(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value : null;
}

async function getStripeReceiptDetails(paymentIntentId: string): Promise<StripeReceiptDetails> {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ["latest_charge"],
    });

    let charge: Stripe.Charge | null = null;
    if (typeof paymentIntent.latest_charge === "string" && paymentIntent.latest_charge) {
        charge = await stripe.charges.retrieve(paymentIntent.latest_charge);
    } else if (paymentIntent.latest_charge && typeof paymentIntent.latest_charge !== "string") {
        charge = paymentIntent.latest_charge;
    }

    return {
        payment_intent_id: paymentIntent.id,
        payment_intent_status: paymentIntent.status,
        charge_id: charge?.id ?? (typeof paymentIntent.latest_charge === "string" ? paymentIntent.latest_charge : null),
        receipt_url: charge?.receipt_url ?? null,
        receipt_email: charge?.receipt_email ?? paymentIntent.receipt_email ?? null,
        amount_received_gbp: toMoney((paymentIntent.amount_received || paymentIntent.amount || 0) / 100),
    };
}

async function getUserConnectRow(client: PoolClient, userId: string): Promise<UserConnectRow | null> {
    const r = await client.query(
        `SELECT id,
                email,
                stripe_account_id,
                stripe_charges_enabled,
                stripe_payouts_enabled,
                stripe_details_submitted
         FROM users
         WHERE id = $1`,
        [userId]
    );
    if (!r.rowCount) return null;
    return r.rows[0] as UserConnectRow;
}

async function syncStripeAccountStatus(client: PoolClient, userId: string, accountId: string): Promise<ConnectStatus> {
    const account = await stripe.accounts.retrieve(accountId);
    const chargesEnabled = !!account.charges_enabled;
    const payoutsEnabled = !!account.payouts_enabled;
    const detailsSubmitted = !!account.details_submitted;

    await client.query(
        `UPDATE users
         SET stripe_charges_enabled = $1,
             stripe_payouts_enabled = $2,
             stripe_details_submitted = $3,
             updated_at = now()
         WHERE id = $4`,
        [chargesEnabled, payoutsEnabled, detailsSubmitted, userId]
    );

    return {
        account_id: accountId,
        charges_enabled: chargesEnabled,
        payouts_enabled: payoutsEnabled,
        details_submitted: detailsSubmitted,
        onboarding_complete: chargesEnabled && payoutsEnabled && detailsSubmitted,
        dashboard_enabled: chargesEnabled && payoutsEnabled && detailsSubmitted,
        demo_bypass: false,
        demo_available: DEMO_PAYOUTS_ENABLED,
    };
}

async function resolveOwnerConnectStatus(ownerUserId: string, accountIdRaw: unknown): Promise<OwnerConnectResult> {
    const ownerAccountId = typeof accountIdRaw === "string" ? accountIdRaw : null;
    const ownerAccountUsable = ownerAccountId && !isDemoConnectAccountId(ownerAccountId) ? ownerAccountId : null;

    let ownerConnectStatus: ConnectStatus;
    if (ownerAccountUsable) {
        const statusClient = await pool.connect();
        try {
            ownerConnectStatus = await syncStripeAccountStatus(statusClient, ownerUserId, ownerAccountUsable);
        } finally {
            statusClient.release();
        }
    } else if (DEMO_PAYOUTS_ENABLED || isDemoConnectAccountId(ownerAccountId)) {
        ownerConnectStatus = demoConnectStatus(ownerAccountId ?? null);
    } else {
        return { ok: false, error: "Owner has not connected Stripe payouts yet." };
    }

    if (!ownerConnectStatus.onboarding_complete) {
        return { ok: false, error: "Owner Stripe onboarding is not complete yet." };
    }

    return { ok: true, ownerAccountUsable, ownerConnectStatus };
}

async function upsertLatestPaymentRow(
    client: PoolClient,
    bookingId: string,
    paymentIntentId: string,
    amountGbp: number,
    status: "pending" | "succeeded" | "failed"
) {
    const updateR = await client.query(
        `UPDATE payments
         SET provider = 'stripe',
             provider_ref = $2,
             status = $3,
             amount_gbp = $4,
             updated_at = now()
         WHERE id = (
             SELECT id
             FROM payments
             WHERE booking_id = $1
             ORDER BY updated_at DESC NULLS LAST, created_at DESC, id DESC
             LIMIT 1
         )
         RETURNING id`,
        [bookingId, paymentIntentId, status, amountGbp]
    );

    if (!updateR.rowCount) {
        await client.query(
            `INSERT INTO payments (booking_id, provider, provider_ref, status, amount_gbp, created_at, updated_at)
             VALUES ($1, 'stripe', $2, $3, $4, now(), now())`,
            [bookingId, paymentIntentId, status, amountGbp]
        );
    }
}

async function awardMoneyBookingRewardIfNeeded(client: PoolClient, booking: any) {
    const paid = toMoney(booking.total_price_gbp) > 0;
    if (!paid) return;
    const points = moneyBookingRewardPoints(booking.total_price_gbp);
    if (points <= 0) return;

    const existingRewardR = await client.query(
        `SELECT 1
         FROM reward_transactions
         WHERE user_id = $1
           AND reason = 'booking_purchase'
           AND related_booking_id = $2
         LIMIT 1`,
        [booking.driver_user_id, booking.id]
    );
    if (existingRewardR.rowCount) return;

    await client.query(
        `UPDATE users
         SET points_balance = points_balance + $1, updated_at = now()
         WHERE id = $2`,
        [points, booking.driver_user_id]
    );

    await client.query(
        `INSERT INTO reward_transactions (user_id, type, amount, reason, related_booking_id, related_spot_id)
         VALUES ($1, 'earn', $2, 'booking_purchase', $3, $4)`,
        [booking.driver_user_id, points, booking.id, booking.parking_spot_id]
    );
}

async function finalizePaymentIntent(paymentIntent: Stripe.PaymentIntent) {
    const bookingId = paymentIntent.metadata?.booking_id;
    if (!bookingId) return;

    const paidAmountGbp = toMoney((paymentIntent.amount_received || paymentIntent.amount || 0) / 100);
    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const bookingR = await client.query(
            `SELECT id, driver_user_id, parking_spot_id, pay_method, status, total_price_gbp
             FROM bookings
             WHERE id = $1
             FOR UPDATE`,
            [bookingId]
        );

        if (!bookingR.rowCount) {
            await client.query("COMMIT");
            return;
        }

        const booking = bookingR.rows[0];
        if (booking.pay_method !== "money") {
            await client.query("COMMIT");
            return;
        }

        await upsertLatestPaymentRow(client, bookingId, paymentIntent.id, paidAmountGbp, "succeeded");

        if (booking.status !== "confirmed") {
            await client.query(
                `UPDATE bookings
                 SET status = 'confirmed', updated_at = now()
                 WHERE id = $1`,
                [bookingId]
            );
        }

        await awardMoneyBookingRewardIfNeeded(client, booking);
        await client.query("COMMIT");
    } catch (e) {
        await client.query("ROLLBACK");
        throw e;
    } finally {
        client.release();
    }
}

async function markPaymentIntentFailed(paymentIntent: Stripe.PaymentIntent) {
    const bookingId = paymentIntent.metadata?.booking_id;
    if (!bookingId) return;

    const amountGbp = toMoney((paymentIntent.amount || 0) / 100);
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await upsertLatestPaymentRow(client, bookingId, paymentIntent.id, amountGbp, "failed");
        await client.query("COMMIT");
    } catch (e) {
        await client.query("ROLLBACK");
        throw e;
    } finally {
        client.release();
    }
}

function normalizeStripePaymentStatus(
    status: Stripe.PaymentIntent.Status
): "pending" | "succeeded" | "failed" {
    if (status === "succeeded") return "succeeded";
    if (status === "canceled" || status === "requires_payment_method") return "failed";
    return "pending";
}

async function syncBookingPaymentFromReceipt(
    bookingId: string,
    paymentIntentId: string,
    amountGbp: number,
    status: "pending" | "succeeded" | "failed"
) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const bookingR = await client.query(
            `SELECT id, driver_user_id, parking_spot_id, pay_method, status, total_price_gbp
             FROM bookings
             WHERE id = $1
             FOR UPDATE`,
            [bookingId]
        );
        if (!bookingR.rowCount) {
            await client.query("COMMIT");
            return;
        }

        const booking = bookingR.rows[0];
        if (booking.pay_method !== "money") {
            await client.query("COMMIT");
            return;
        }

        await upsertLatestPaymentRow(client, bookingId, paymentIntentId, amountGbp, status);

        if (status === "succeeded") {
            if (booking.status !== "confirmed") {
                await client.query(
                    `UPDATE bookings
                     SET status = 'confirmed', updated_at = now()
                     WHERE id = $1`,
                    [bookingId]
                );
            }
            await awardMoneyBookingRewardIfNeeded(client, booking);
        }

        await client.query("COMMIT");
    } catch (e) {
        await client.query("ROLLBACK");
        throw e;
    } finally {
        client.release();
    }
}

router.post("/connect/onboard", requireAuth, async (req: AuthRequest, res) => {
    const userId = requireUserId(req, res);
    if (!userId) return;
    const parsedBody = parseWithSchema(connectOnboardBodySchema, req.body ?? {}, res, "connect_onboard");
    if (!parsedBody.ok) return;

    const client = await pool.connect();
    try {
        const row = await getUserConnectRow(client, userId);
        if (!row) return res.status(404).json({ ok: false, error: "User not found" });

        const requestedMode = parsedBody.data.mode === "demo" ? "demo" : "stripe";
        if (requestedMode === "demo") {
            if (!DEMO_PAYOUTS_ENABLED) {
                return res.status(400).json({
                    ok: false,
                    error: "Demo payouts are disabled on this server.",
                });
            }
            if (row.stripe_account_id && !isDemoConnectAccountId(row.stripe_account_id)) {
                const status = await syncStripeAccountStatus(client, userId, row.stripe_account_id);
                return res.json({
                    ok: true,
                    connect: status,
                });
            }
            return res.json({
                ok: true,
                url: `${frontendBaseUrl()}/dashboard?tab=payouts&connect=demo`,
                connect: demoConnectStatus(
                    isDemoConnectAccountId(row.stripe_account_id) ? row.stripe_account_id : null
                ),
            });
        }

        let accountId = row.stripe_account_id;
        if (isDemoConnectAccountId(accountId)) {
            accountId = null;
        }
        if (!accountId) {
            const account = await stripe.accounts.create({
                type: "express",
                country: STRIPE_CONNECT_COUNTRY,
                email: row.email,
                capabilities: {
                    card_payments: { requested: true },
                    transfers: { requested: true },
                },
                metadata: { user_id: userId },
            });
            accountId = account.id;
            await client.query(
                `UPDATE users
                 SET stripe_account_id = $1, updated_at = now()
                 WHERE id = $2`,
                [accountId, userId]
            );
        }

        if (!accountId) {
            return res.status(500).json({ ok: false, error: "Failed to create Stripe account" });
        }

        const status = await syncStripeAccountStatus(client, userId, accountId);
        const baseUrl = frontendBaseUrl();
        const link = await stripe.accountLinks.create({
            account: accountId,
            type: "account_onboarding",
            refresh_url: `${baseUrl}/dashboard?tab=payouts&connect=refresh`,
            return_url: `${baseUrl}/dashboard?tab=payouts&connect=return`,
        });

        return res.json({ ok: true, url: link.url, connect: status });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    } finally {
        client.release();
    }
});

router.get("/connect/status", requireAuth, async (req: AuthRequest, res) => {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const client = await pool.connect();
    try {
        const row = await getUserConnectRow(client, userId);
        if (!row) return res.status(404).json({ ok: false, error: "User not found" });
        const accountId = row.stripe_account_id;

        if (isDemoConnectAccountId(accountId) || (DEMO_PAYOUTS_ENABLED && !accountId)) {
            return res.json({
                ok: true,
                connect: demoConnectStatus(isDemoConnectAccountId(accountId) ? accountId : null),
            });
        }

        if (!accountId) {
            return res.json({
                ok: true,
                connect: disconnectedConnectStatus(),
            });
        }

        const status = await syncStripeAccountStatus(client, userId, accountId);
        return res.json({ ok: true, connect: status });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    } finally {
        client.release();
    }
});

router.post("/connect/dashboard-link", requireAuth, async (req: AuthRequest, res) => {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const client = await pool.connect();
    try {
        const row = await getUserConnectRow(client, userId);
        if (!row) return res.status(404).json({ ok: false, error: "User not found" });
        const accountId = row.stripe_account_id;

        if ((DEMO_PAYOUTS_ENABLED && !accountId) || isDemoConnectAccountId(accountId)) {
            return res.status(400).json({
                ok: false,
                error: "Demo payouts are active. Connect Stripe first to open a Stripe dashboard.",
            });
        }
        if (!accountId) {
            return res.status(400).json({ ok: false, error: "Stripe account not connected yet" });
        }

        const status = await syncStripeAccountStatus(client, userId, accountId);
        if (!status.onboarding_complete) {
            return res.status(400).json({
                ok: false,
                error: "Stripe onboarding is incomplete. Please complete onboarding first.",
            });
        }

        const link = await stripe.accounts.createLoginLink(accountId);
        return res.json({ ok: true, url: link.url, connect: status });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    } finally {
        client.release();
    }
});

router.post("/checkout-session", requireAuth, async (req: AuthRequest, res) => {
    const parsedBody = parseWithSchema(checkoutSessionBodySchema, req.body ?? {}, res, "checkout_session");
    if (!parsedBody.ok) return;
    const { booking_id } = parsedBody.data;

    try {
        const bookingR = await pool.query(
            `SELECT b.id,
                    b.status,
                    b.driver_user_id,
                    b.pay_method,
                    b.total_price_gbp,
                    b.start_time,
                    b.end_time,
                    ps.title AS spot_title,
                    ps.address_text AS spot_address,
                    ps.owner_user_id,
                    owner.stripe_account_id,
                    driver.email AS driver_email
             FROM bookings b
                      JOIN parking_spots ps ON ps.id = b.parking_spot_id
                      JOIN users owner ON owner.id = ps.owner_user_id
                      JOIN users driver ON driver.id = b.driver_user_id
             WHERE b.id = $1
               AND b.driver_user_id = $2`,
            [booking_id, req.userId]
        );

        if (!bookingR.rowCount) {
            return res.status(404).json({ ok: false, error: "Booking not found" });
        }

        const booking = bookingR.rows[0];
        if (booking.pay_method !== "money" || booking.status !== "pending") {
            return res.status(400).json({ ok: false, error: "Booking is not payable" });
        }

        const amountGbp = toMoney(booking.total_price_gbp);
        if (amountGbp <= 0) {
            return res.status(400).json({ ok: false, error: "Invalid booking amount" });
        }

        const ownerConnect = await resolveOwnerConnectStatus(booking.owner_user_id, booking.stripe_account_id);
        if (!ownerConnect.ok) return res.status(400).json({ ok: false, error: ownerConnect.error });
        const { ownerAccountUsable, ownerConnectStatus } = ownerConnect;

        const amountPence = Math.round(amountGbp * 100);
        const baseUrl = frontendBaseUrl();
        const title = booking.spot_title ?? "Parking booking";
        const address = booking.spot_address ?? "Address on file";
        const when = booking.start_time && booking.end_time ? `${booking.start_time} -> ${booking.end_time}` : "Time on file";

        const paymentIntentData: Stripe.Checkout.SessionCreateParams.PaymentIntentData = {
            metadata: {
                booking_id,
                user_id: req.userId ?? "",
                owner_user_id: booking.owner_user_id,
                owner_account_id: ownerAccountUsable ?? "",
                type: "rent_booking",
                demo_bypass_connect: ownerConnectStatus.demo_bypass ? "true" : "false",
            },
            description: `Booking ${booking_id} | ${title} | ${address} | ${when}`,
        };
        if (ownerAccountUsable && !ownerConnectStatus.demo_bypass) {
            paymentIntentData.transfer_data = { destination: ownerAccountUsable };
            paymentIntentData.on_behalf_of = ownerAccountUsable;
        }

        // credit: Stripe Checkout session flow follows official Stripe docs/samples
        const session = await stripe.checkout.sessions.create({
            mode: "payment",
            payment_method_types: ["card"],
            success_url: `${baseUrl}/pay/${booking_id}?success=1&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${baseUrl}/pay/${booking_id}?canceled=1`,
            customer_email: typeof booking.driver_email === "string" ? booking.driver_email.trim().toLowerCase() : undefined,
            line_items: [
                {
                    quantity: 1,
                    price_data: {
                        currency: "gbp",
                        unit_amount: amountPence,
                        product_data: {
                            name: title,
                            description: `Location: ${address}\nWhen: ${when}\nBooking: ${booking_id}`,
                        },
                    },
                },
            ],
            payment_intent_data: paymentIntentData,
        });

        const paymentIntentId =
            typeof session.payment_intent === "string" ? session.payment_intent : null;

        if (paymentIntentId) {
            const client = await pool.connect();
            try {
                await client.query("BEGIN");
                await upsertLatestPaymentRow(client, booking_id, paymentIntentId, amountGbp, "pending");
                await client.query("COMMIT");
            } catch (e) {
                await client.query("ROLLBACK");
                throw e;
            } finally {
                client.release();
            }
            await pool.query(
                `UPDATE bookings
                 SET payment_provider_ref = $1,
                     updated_at = now()
                 WHERE id = $2`,
                [paymentIntentId, booking_id]
            );
        }

        return res.json({ ok: true, url: session.url });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

router.post("/auction-intent", requireAuth, async (req: AuthRequest, res) => {
    const parsedBody = parseWithSchema(auctionIntentBodySchema, req.body ?? {}, res, "auction_intent");
    if (!parsedBody.ok) return;
    const { spot_id, amount_gbp } = parsedBody.data;

    const amount = toMoney(amount_gbp);
    if (amount <= 0) {
        return res.status(400).json({ ok: false, error: "amount_gbp is invalid" });
    }

    try {
        const spotR = await pool.query(
            `SELECT ps.id,
                    ps.mode,
                    ps.owner_user_id,
                    owner.stripe_account_id
             FROM parking_spots ps
                      JOIN users owner ON owner.id = ps.owner_user_id
             WHERE ps.id = $1`,
            [spot_id]
        );
        if (!spotR.rowCount) {
            return res.status(404).json({ ok: false, error: "Listing not found" });
        }

        const spot = spotR.rows[0];
        if (spot.mode !== "auction") {
            return res.status(400).json({ ok: false, error: "Listing is not an auction" });
        }
        if (spot.owner_user_id === req.userId) {
            return res.status(400).json({ ok: false, error: "Owners cannot bid on their own listings" });
        }
        const ownerConnect = await resolveOwnerConnectStatus(spot.owner_user_id, spot.stripe_account_id);
        if (!ownerConnect.ok) return res.status(400).json({ ok: false, error: ownerConnect.error });
        const { ownerAccountUsable, ownerConnectStatus } = ownerConnect;

        const amountPence = Math.round(amount * 100);
        const paymentIntentPayload: Stripe.PaymentIntentCreateParams = {
            amount: amountPence,
            currency: "gbp",
            capture_method: "manual",
            payment_method_types: ["card"],
            metadata: {
                spot_id,
                user_id: req.userId ?? "",
                owner_user_id: spot.owner_user_id,
                owner_account_id: ownerAccountUsable ?? "",
                type: "auction_bid",
                demo_bypass_connect: ownerConnectStatus.demo_bypass ? "true" : "false",
            },
        };
        if (ownerAccountUsable && !ownerConnectStatus.demo_bypass) {
            paymentIntentPayload.transfer_data = { destination: ownerAccountUsable };
            paymentIntentPayload.on_behalf_of = ownerAccountUsable;
        }

        const intent = await stripe.paymentIntents.create(paymentIntentPayload);

        return res.json({
            ok: true,
            client_secret: intent.client_secret,
            payment_intent_id: intent.id,
        });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

router.get("/booking/:bookingId/receipt", requireAuth, async (req: AuthRequest, res) => {
    const parsedParams = parseWithSchema(bookingReceiptParamsSchema, req.params ?? {}, res, "booking_receipt");
    if (!parsedParams.ok) return;
    const parsedQuery = parseWithSchema(bookingReceiptQuerySchema, req.query ?? {}, res, "booking_receipt");
    if (!parsedQuery.ok) return;
    const bookingId = parsedParams.data.bookingId;
    const sessionId = parsedQuery.data.session_id ?? null;

    try {
        const bookingR = await pool.query(
            `SELECT id, payment_provider_ref
             FROM bookings
             WHERE id = $1 AND driver_user_id = $2`,
            [bookingId, req.userId]
        );
        if (!bookingR.rowCount) {
            return res.status(404).json({ ok: false, error: "Booking not found" });
        }

        const paymentR = await pool.query(
            `SELECT
                 provider_ref,
                 status
             FROM payments
             WHERE booking_id = $1
             ORDER BY updated_at DESC NULLS LAST, created_at DESC, id DESC
             LIMIT 1`,
            [bookingId]
        );

        let providerRef: string | null = null;
        if (paymentR.rowCount) {
            providerRef = asNonEmptyString(paymentR.rows[0].provider_ref);
        }
        if (!providerRef) {
            providerRef = asNonEmptyString(bookingR.rows[0].payment_provider_ref);
        }

        if (!providerRef && sessionId) {
            const session = await stripe.checkout.sessions.retrieve(sessionId, {
                expand: ["payment_intent"],
            });
            const intent = session.payment_intent;
            const paymentIntentId =
                asNonEmptyString(typeof intent === "string" ? intent : intent && typeof intent === "object" ? intent.id : null);
            if (paymentIntentId) {
                providerRef = paymentIntentId;
                const normalizedStatus =
                    session.payment_status === "paid"
                        ? "succeeded"
                        : "pending";
                await syncBookingPaymentFromReceipt(bookingId, providerRef, 0, normalizedStatus);

                await pool.query(
                    `UPDATE bookings
                     SET payment_provider_ref = $1,
                         updated_at = now()
                     WHERE id = $2`,
                    [providerRef, bookingId]
                );
            }
        }

        if (!providerRef) {
            return res.status(404).json({ ok: false, error: "No Stripe payment reference found" });
        }

        const receipt = await getStripeReceiptDetails(providerRef);
        const normalizedPaymentStatus = normalizeStripePaymentStatus(receipt.payment_intent_status);
        await syncBookingPaymentFromReceipt(
            bookingId,
            receipt.payment_intent_id,
            receipt.amount_received_gbp,
            normalizedPaymentStatus
        );

        await pool.query(
            `UPDATE bookings
             SET payment_provider_ref = $1,
                 updated_at = now()
             WHERE id = $2`,
            [receipt.payment_intent_id, bookingId]
        );

        return res.json({ ok: true, receipt, payment_status: normalizedPaymentStatus });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

router.get("/me", requireAuth, async (req: AuthRequest, res) => {
    try {
        const r = await pool.query(
            `WITH outgoing AS (
                SELECT
                    COALESCE(pay.id::text, ('booking-' || b.id::text)) AS id,
                    b.id AS booking_id,
                    COALESCE(pay.provider, 'stripe') AS provider,
                    COALESCE(pay.status, CASE WHEN b.status = 'confirmed' THEN 'succeeded' ELSE 'created' END) AS status,
                    COALESCE(pay.amount_gbp, b.total_price_gbp, 0) AS amount_gbp,
                    COALESCE(pay.updated_at, pay.created_at, b.updated_at, b.created_at) AS created_at,
                    b.start_time,
                    b.end_time,
                    ps.title AS spot_title,
                    ps.address_text AS spot_address,
                    'outgoing'::text AS direction
                FROM bookings b
                JOIN parking_spots ps ON ps.id = b.parking_spot_id
                LEFT JOIN LATERAL (
                    SELECT
                        p.id,
                        p.provider,
                        p.status,
                        p.amount_gbp,
                        p.created_at,
                        p.updated_at
                    FROM payments p
                    WHERE p.booking_id = b.id
                    ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC, p.id DESC
                    LIMIT 1
                ) pay ON TRUE
                WHERE b.driver_user_id = $1
                  AND b.pay_method = 'money'
                  AND COALESCE(b.total_price_gbp, 0) > 0
            ),
            incoming AS (
                SELECT
                    COALESCE(pay.id::text, ('booking-' || b.id::text || '-in')) AS id,
                    b.id AS booking_id,
                    COALESCE(pay.provider, 'stripe') AS provider,
                    COALESCE(pay.status, CASE WHEN b.status = 'confirmed' THEN 'succeeded' ELSE 'pending' END) AS status,
                    COALESCE(pay.amount_gbp, b.total_price_gbp, 0) AS amount_gbp,
                    COALESCE(pay.updated_at, pay.created_at, b.updated_at, b.created_at) AS created_at,
                    b.start_time,
                    b.end_time,
                    ps.title AS spot_title,
                    ps.address_text AS spot_address,
                    'incoming'::text AS direction
                FROM bookings b
                JOIN parking_spots ps ON ps.id = b.parking_spot_id
                LEFT JOIN LATERAL (
                    SELECT
                        p.id,
                        p.provider,
                        p.status,
                        p.amount_gbp,
                        p.created_at,
                        p.updated_at
                    FROM payments p
                    WHERE p.booking_id = b.id
                    ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC, p.id DESC
                    LIMIT 1
                ) pay ON TRUE
                WHERE ps.owner_user_id = $1
                  AND b.pay_method = 'money'
                  AND COALESCE(b.total_price_gbp, 0) > 0
                  AND b.status IN ('pending', 'confirmed')
            )
            SELECT * FROM outgoing
            UNION ALL
            SELECT * FROM incoming
            ORDER BY created_at DESC`,
            [req.userId]
        );

        return res.json({ ok: true, payments: r.rows });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

export async function stripeWebhookHandler(req: Request, res: Response) {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
        return res.status(500).json({ ok: false, error: "Missing STRIPE_WEBHOOK_SECRET" });
    }

    const signature = req.headers["stripe-signature"];
    if (typeof signature !== "string" || !signature) {
        return res.status(400).json({ ok: false, error: "Missing stripe-signature header" });
    }

    let event: Stripe.Event;
    try {
        event = stripe.webhooks.constructEvent(req.body as Buffer, signature, webhookSecret);
    } catch (e) {
        return res.status(400).json({ ok: false, error: `Webhook signature verification failed: ${String(e)}` });
    }

    try {
        if (event.type === "payment_intent.succeeded") {
            await finalizePaymentIntent(event.data.object as Stripe.PaymentIntent);
        } else if (event.type === "payment_intent.payment_failed" || event.type === "payment_intent.canceled") {
            await markPaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
        }
        return res.json({ ok: true, received: true });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
}

export default router;

