import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { apiGet, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string);

type Booking = {
    id: string;
    status: "pending" | "confirmed" | "cancelled" | string;
    pay_method: "money" | "points" | string;
    total_price_gbp: number | string | null;
    total_points?: number | null;
    spot_title?: string;
    spot_address?: string;
    start_time?: string;
    end_time?: string;
    payment_provider_ref?: string | null;
};

type StripeReceiptDetails = {
    payment_intent_id: string;
    charge_id: string | null;
    receipt_url: string | null;
    receipt_email: string | null;
    amount_received_gbp: number;
};

type ConfirmIntentResponse = {
    booking: Booking;
    receipt: StripeReceiptDetails | null;
};

function formatDateTime(value?: string | null) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString();
}

function money(value: unknown) {
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? n : 0;
}

function StripeCheckoutForm({
    bookingId,
    paymentIntentId,
    token,
    onConfirmed,
}: {
    bookingId: string;
    paymentIntentId: string;
    token: string;
    onConfirmed: (result: ConfirmIntentResponse) => void;
}) {
    const stripe = useStripe();
    const elements = useElements();
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    async function confirmPayment() {
        if (!stripe || !elements) return;
        setBusy(true);
        setErr(null);

        try {
            const stripeResult = await stripe.confirmPayment({
                elements,
                redirect: "if_required",
            });

            if (stripeResult.error) {
                setErr(stripeResult.error.message ?? "Payment failed.");
                return;
            }

            const confirmedIntentId = stripeResult.paymentIntent?.id ?? paymentIntentId;
            const verified = await apiPost<ConfirmIntentResponse>(
                "/payments/confirm-intent",
                {
                    booking_id: bookingId,
                    payment_intent_id: confirmedIntentId,
                },
                token
            );

            onConfirmed(verified);
        } catch (e: any) {
            setErr(e?.message || "Payment confirmation failed.");
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="card formSection">
            <div className="h3">Secure Stripe checkout</div>
            <div className="muted" style={{ marginTop: 6 }}>
                Your payment is processed by Stripe. You will get an official Stripe receipt after success.
            </div>
            <div style={{ marginTop: 12 }}>
                <PaymentElement />
            </div>
            <div className="rowInline" style={{ marginTop: 12 }}>
                <button className="btn btn-primary" disabled={!stripe || busy} onClick={confirmPayment}>
                    {busy ? "Processing..." : "Pay securely"}
                </button>
            </div>
            {err && <div className="spotAlert" style={{ marginTop: 10 }}>{err}</div>}
            <div className="tiny muted" style={{ marginTop: 10 }}>
                Test card: `4242 4242 4242 4242` (future expiry, any CVC)
            </div>
        </div>
    );
}

export default function PayBookingPage() {
    const { bookingId } = useParams();
    const { token, user } = useAuth();
    const [booking, setBooking] = useState<Booking | null>(null);
    const [clientSecret, setClientSecret] = useState<string | null>(null);
    const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
    const [receipt, setReceipt] = useState<StripeReceiptDetails | null>(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);

    const id = bookingId ?? "";

    const requiresPayment = useMemo(() => {
        if (!booking) return false;
        return booking.pay_method === "money" && booking.status === "pending" && money(booking.total_price_gbp) > 0;
    }, [booking]);

    useEffect(() => {
        if (!id) {
            setErr("Missing booking ID.");
            setLoading(false);
            return;
        }
        if (!token) {
            setErr("Please sign in to continue.");
            setLoading(false);
            return;
        }

        (async () => {
            setLoading(true);
            setErr(null);
            setReceipt(null);

            try {
                const bookingRes = await apiGet<{ booking: Booking }>(`/bookings/${id}`, token);
                const currentBooking = bookingRes.booking;
                setBooking(currentBooking);

                const needsPayment =
                    currentBooking.pay_method === "money" &&
                    currentBooking.status === "pending" &&
                    money(currentBooking.total_price_gbp) > 0;

                if (needsPayment) {
                    const intentRes = await apiPost<{ client_secret: string; payment_intent_id: string }>(
                        "/payments/create-intent",
                        { booking_id: id },
                        token
                    );
                    setClientSecret(intentRes.client_secret);
                    setPaymentIntentId(intentRes.payment_intent_id);
                } else {
                    setClientSecret(null);
                    setPaymentIntentId(null);
                    if (currentBooking.pay_method === "money") {
                        try {
                            const receiptRes = await apiGet<{ receipt: StripeReceiptDetails }>(
                                `/payments/booking/${id}/receipt`,
                                token
                            );
                            setReceipt(receiptRes.receipt ?? null);
                        } catch {
                            setReceipt(null);
                        }
                    }
                }
            } catch (e: any) {
                setErr(e?.message || "Could not load payment details.");
            } finally {
                setLoading(false);
            }
        })();
    }, [id, token]);

    if (!token) return <Navigate to="/login" replace />;

    return (
        <div className="container">
            <div className="pageHeader">
                <div className="heroKicker">PAYMENT</div>
                <div className="heroTitle">Stripe checkout</div>
                <div className="heroSub muted">Fast checkout with official Stripe receipt and email.</div>
            </div>

            {loading && <div className="card formSection">Loading checkout...</div>}
            {err && <div className="card formSection" style={{ color: "crimson" }}>{err}</div>}

            {!loading && !err && booking && (
                <>
                    <div className="card receiptCard">
                        <div className="receiptHeader">
                            <div className="h2">Booking summary</div>
                            <div className="tiny muted">Booking #{booking.id}</div>
                        </div>
                        <div className="receiptBody">
                            <div className="receiptRow">
                                <span className="tiny muted">Spot</span>
                                <span className="spotInfoValue">{booking.spot_title ?? "—"}</span>
                            </div>
                            <div className="receiptRow">
                                <span className="tiny muted">Address</span>
                                <span className="spotInfoValue">{booking.spot_address ?? "—"}</span>
                            </div>
                            <div className="receiptRow">
                                <span className="tiny muted">When</span>
                                <span className="spotInfoValue">
                                    {formatDateTime(booking.start_time)} → {formatDateTime(booking.end_time)}
                                </span>
                            </div>
                            <div className="receiptRow">
                                <span className="tiny muted">Amount</span>
                                <span className="spotInfoValue">
                                    {booking.pay_method === "points"
                                        ? `${Number(booking.total_points ?? 0)} pts`
                                        : `£${money(booking.total_price_gbp).toFixed(2)}`}
                                </span>
                            </div>
                            <div className="receiptRow">
                                <span className="tiny muted">Status</span>
                                <span className="spotInfoValue">{booking.status}</span>
                            </div>
                        </div>
                    </div>

                    {requiresPayment && clientSecret && paymentIntentId && (
                        <Elements stripe={stripePromise} options={{ clientSecret }}>
                            <StripeCheckoutForm
                                bookingId={booking.id}
                                paymentIntentId={paymentIntentId}
                                token={token}
                                onConfirmed={(result) => {
                                    setBooking(result.booking);
                                    setReceipt(result.receipt ?? null);
                                    setClientSecret(null);
                                    setPaymentIntentId(null);
                                }}
                            />
                        </Elements>
                    )}

                    {!requiresPayment && (
                        <div className="card formSection">
                            <div className="h3">
                                {booking.pay_method === "money" ? "Payment already completed" : "Points booking confirmed"}
                            </div>
                            <div className="muted" style={{ marginTop: 6 }}>
                                {booking.pay_method === "money"
                                    ? "This booking has already been paid."
                                    : "No Stripe payment is needed for points bookings."}
                            </div>
                        </div>
                    )}

                    {receipt && (
                        <div className="card formSection">
                            <div className="h3">Official Stripe receipt</div>
                            <div className="muted" style={{ marginTop: 6 }}>
                                {receipt.receipt_email
                                    ? `Receipt email sent to ${receipt.receipt_email}.`
                                    : `Receipt email will use your Stripe/default account settings${user?.email ? ` (${user.email})` : ""}.`}
                            </div>
                            <div className="rowInline" style={{ marginTop: 12 }}>
                                {receipt.receipt_url ? (
                                    <a
                                        className="btn btn-primary"
                                        href={receipt.receipt_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        Open Stripe receipt
                                    </a>
                                ) : (
                                    <span className="tiny muted">Stripe receipt link is not available yet.</span>
                                )}
                                <Link className="btn" to={`/bookings/${booking.id}`}>
                                    Booking details
                                </Link>
                                <Link className="btn" to="/dashboard?tab=myBookings">
                                    Dashboard
                                </Link>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
