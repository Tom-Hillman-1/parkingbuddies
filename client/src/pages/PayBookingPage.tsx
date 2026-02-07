import { useEffect, useMemo, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, CardElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { apiGet, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string);

function CardForm({
                      bookingId,
                      clientSecret,
                      paymentIntentId,
                      onPaid,
                      token,
                  }: {
    bookingId: string;
    clientSecret: string;
    paymentIntentId: string;
    onPaid: () => void;
    token: string;
}) {
    const stripe = useStripe();
    const elements = useElements();

    const [status, setStatus] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    async function pay() {
        if (!stripe || !elements) return;
        setBusy(true);
        setStatus(null);

        const card = elements.getElement(CardElement);
        if (!card) {
            setStatus("Card input not ready");
            setBusy(false);
            return;
        }

        const result = await stripe.confirmCardPayment(clientSecret, {
            payment_method: { card },
        });

        if (result.error) {
            setStatus(result.error.message ?? "Payment failed");
            setBusy(false);
            return;
        }

        // Payment succeeded on Stripe side.
        setStatus("Payment successful ✅");
        setBusy(false);

        const confirmedIntentId = result.paymentIntent?.id ?? paymentIntentId;
        if (!confirmedIntentId) {
            setStatus("Payment succeeded but confirmation ID was missing.");
            return;
        }

        try {
            await apiPost(
                "/payments/confirm-intent",
                {
                    booking_id: bookingId,
                    payment_intent_id: confirmedIntentId,
                },
                token
            );
            onPaid();
        } catch (e: any) {
            setStatus(e?.message || "Payment was successful but confirmation failed.");
        }
    }

    return (
        <div className="card" style={{ padding: 16 }}>
            <div className="h3">Enter card details</div>

            <div style={{ padding: 10, border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, marginTop: 10 }}>
                <CardElement options={{ hidePostalCode: true }} />
            </div>

            <button
                onClick={pay}
                disabled={!stripe || busy}
                className="btn btn-primary"
                style={{ marginTop: 12 }}
            >
                {busy ? "Processing…" : "Pay now"}
            </button>

            {status && <div className="tiny" style={{ marginTop: 10 }}>{status}</div>}

            <p style={{ marginTop: 10, fontSize: 13, opacity: 0.8 }}>
                Test card: <code>4242 4242 4242 4242</code> • any future expiry • any CVC
            </p>
        </div>
    );
}

export default function PayBookingPage() {
    const { bookingId } = useParams();
    const navigate = useNavigate();
    const { token } = useAuth();

    const [clientSecret, setClientSecret] = useState<string | null>(null);
    const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [paid, setPaid] = useState(false);
    const [receipt, setReceipt] = useState<any | null>(null);
    const [booking, setBooking] = useState<any | null>(null);

    const id = bookingId ?? "";

    useEffect(() => {
        if (!id) {
            setErr("Missing bookingId in URL");
            setLoading(false);
            return;
        }
        if (!token) {
            setErr("You must be logged in to pay");
            setLoading(false);
            return;
        }

        (async () => {
            try {
                setLoading(true);
                setErr(null);

                const bookingR = await apiGet<{ booking: any }>(`/bookings/${id}`, token);
                const b = bookingR.booking ?? null;
                setBooking(b);
                setReceipt(b);

                if (b?.pay_method === "money" && Number(b?.total_price_gbp ?? 0) > 0 && b?.status === "pending") {
                    const r = await apiPost<{ client_secret: string; payment_intent_id: string }>(
                        "/payments/create-intent",
                        { booking_id: id },
                        token
                    );
                    setClientSecret(r.client_secret);
                    setPaymentIntentId(r.payment_intent_id);
                } else {
                    setClientSecret(null);
                    setPaymentIntentId(null);
                }
            } catch (e) {
                setErr(e instanceof Error ? e.message : "Failed to create payment intent");
            } finally {
                setLoading(false);
            }
        })();
    }, [id, token]);

    const ready = useMemo(() => Boolean(clientSecret), [clientSecret]);

    async function loadReceipt() {
        if (!token) return;
        try {
            const r = await apiGet<{ booking: any }>(`/bookings/${id}`, token);
            setBooking(r.booking ?? null);
            setReceipt(r.booking ?? null);
        } catch {
            setReceipt(null);
        }
    }

    useEffect(() => {
        if (!paid) return;
        const timeoutId = setTimeout(() => {
            navigate("/dashboard?tab=myBookings");
        }, 6000);
        return () => clearTimeout(timeoutId);
    }, [paid, navigate]);

    const statusLabel = booking?.status === "pending"
        ? "Pending"
        : booking?.status === "confirmed"
            ? "Confirmed"
            : booking?.status ?? "—";

    const paymentLabel = booking?.pay_method === "points"
        ? "Points"
        : booking?.pay_method === "money"
            ? "Card"
            : "—";

    return (
        <div className="container">
            <div className="pageHeader">
                <div className="heroKicker">CONFIRMATION</div>
                <div className="heroTitle">Confirm the details</div>
                <div className="heroSub muted">
                    Confirm your payment details and reservation summary.
                </div>
            </div>

            {loading && <div className="card formSection">Preparing your receipt…</div>}
            {err && <div className="card formSection" style={{ color: "crimson" }}>{err}</div>}

            {!loading && !err && booking && (
                <>
                    <div className="card receiptCard">
                        <div className="receiptHeader">
                            <div className="heroKicker">PARKINGBUDDIES</div>
                            <div className="h2">Booking receipt</div>
                            <div className="tiny muted">Confirmation #{id}</div>
                        </div>
                        <div className="receiptBody">
                            <div className="receiptRow">
                                <span className="tiny muted">Status</span>
                                <span className="spotInfoValue">{statusLabel}</span>
                            </div>
                            <div className="receiptRow">
                                <span className="tiny muted">Payment</span>
                                <span className="spotInfoValue">{paymentLabel}</span>
                            </div>
                            <div className="receiptRow">
                                <span className="tiny muted">Spot</span>
                                <span className="spotInfoValue">{booking?.spot_title ?? "—"}</span>
                            </div>
                            <div className="receiptRow">
                                <span className="tiny muted">Address</span>
                                <span className="spotInfoValue">{booking?.spot_address ?? "—"}</span>
                            </div>
                            <div className="receiptRow">
                                <span className="tiny muted">When</span>
                                <span className="spotInfoValue">
                                    {booking?.start_time && booking?.end_time
                                        ? `${booking.start_time} → ${booking.end_time}`
                                        : "—"}
                                </span>
                            </div>
                            <div className="receiptRow">
                                <span className="tiny muted">Total</span>
                                <span className="spotInfoValue">
                                    {booking?.pay_method === "points"
                                        ? `${Number(booking?.total_points ?? 0)} pts`
                                        : booking?.total_price_gbp != null
                                            ? `£${Number(booking.total_price_gbp).toFixed(2)}`
                                            : "—"}
                                </span>
                            </div>
                        </div>
                    </div>

                    {booking?.pay_method === "money" && booking?.status === "pending" && ready && clientSecret && paymentIntentId && token && !paid && (
                        <Elements stripe={stripePromise} options={{ clientSecret }}>
                            <CardForm
                                bookingId={id}
                                clientSecret={clientSecret}
                                paymentIntentId={paymentIntentId}
                                token={token}
                                onPaid={async () => {
                                    setPaid(true);
                                    await loadReceipt();
                                }}
                            />
                        </Elements>
                    )}

                    {booking?.pay_method === "points" && (
                        <div className="card formSection">
                            <div className="h3">Points payment</div>
                            <div className="muted" style={{ marginTop: 6 }}>
                                Points payments are processed immediately.
                            </div>
                            <div className="rowInline" style={{ marginTop: 10 }}>
                                <Link to="/dashboard?tab=myBookings" className="btn btn-primary">Go to dashboard</Link>
                                <Link to="/" className="btn">Back to home</Link>
                            </div>
                        </div>
                    )}
                </>
            )}

            {paid && (
                <div className="card receiptCard" style={{ marginTop: 12 }}>
                    <div className="receiptHeader">
                        <div className="heroKicker">PAYMENT</div>
                        <div className="h2">Payment confirmed</div>
                        <div className="tiny muted">Receipt #{id}</div>
                    </div>
                    <div className="receiptBody">
                        <div className="receiptRow">
                            <span className="tiny muted">Status</span>
                            <span className="spotInfoValue">Paid</span>
                        </div>
                        <div className="receiptRow">
                            <span className="tiny muted">Spot</span>
                            <span className="spotInfoValue">{receipt?.spot_title ?? "—"}</span>
                        </div>
                        <div className="receiptRow">
                            <span className="tiny muted">Address</span>
                            <span className="spotInfoValue">{receipt?.spot_address ?? "—"}</span>
                        </div>
                        <div className="receiptRow">
                            <span className="tiny muted">When</span>
                            <span className="spotInfoValue">
                                {receipt?.start_time && receipt?.end_time
                                    ? `${receipt.start_time} → ${receipt.end_time}`
                                    : "—"}
                            </span>
                        </div>
                        <div className="receiptRow">
                            <span className="tiny muted">Amount</span>
                            <span className="spotInfoValue">
                                {receipt?.total_price_gbp != null ? `£${Number(receipt.total_price_gbp).toFixed(2)}` : "—"}
                            </span>
                        </div>
                        <div className="receiptRow">
                            <span className="tiny muted">Payment method</span>
                            <span className="spotInfoValue">{receipt?.pay_method ?? "card"}</span>
                        </div>
                    </div>
                    <div className="receiptActions">
                        <div className="tiny muted" style={{ marginBottom: 8 }}>
                            Receipt shown. Redirecting to dashboard in a few seconds...
                        </div>
                        <Link to="/dashboard?tab=myBookings" className="btn btn-primary">Go to dashboard</Link>
                        <Link to="/" className="btn">Back to home</Link>
                    </div>
                </div>
            )}
        </div>
    );
}
