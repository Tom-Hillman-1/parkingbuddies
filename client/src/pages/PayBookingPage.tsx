import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, CardElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { apiGet, apiPatch, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string);

function CardForm({
                      bookingId,
                      clientSecret,
                      onPaid,
                      token,
                  }: {
    bookingId: string;
    clientSecret: string;
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

        try {
            await apiPatch(`/bookings/${bookingId}/mark-paid`, undefined, token);
        } catch {
            // ignore for demo; receipt will still display
        }
        onPaid();
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
    const { token } = useAuth();

    const [clientSecret, setClientSecret] = useState<string | null>(null);
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

                const r = await apiPost<{ client_secret: string; payment_intent_id: string }>(
                    "/payments/create-intent",
                    { booking_id: id },
                    token
                );

                setClientSecret(r.client_secret);
                await loadReceipt();
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
            const r = await apiGet<{ bookings: any[] }>("/bookings/me", token);
            const hit = (r.bookings ?? []).find((b) => b.id === id);
            setBooking(hit ?? null);
            setReceipt(hit ?? null);
        } catch {
            setReceipt(null);
        }
    }

    return (
        <div className="container">
            <div className="pageHeader">
                <div className="heroKicker">PAYMENT</div>
                <div className="heroTitle">Complete your booking</div>
                <div className="heroSub muted">
                    Enter card details to finish the reservation.
                </div>
            </div>

            {loading && <div className="card formSection">Preparing Stripe payment…</div>}
            {err && <div className="card formSection" style={{ color: "crimson" }}>{err}</div>}

            {!loading && !err && ready && clientSecret && !paid && token && (
                <>
                    <div className="card formSection">
                        <div className="h3">Booking summary</div>
                        <div className="spotInfoGrid" style={{ marginTop: 10 }}>
                            <div>
                                <div className="tiny muted">Booking ID</div>
                                <div className="spotInfoValue">{id}</div>
                            </div>
                            <div>
                                <div className="tiny muted">Spot</div>
                                <div className="spotInfoValue">{booking?.spot_title ?? "—"}</div>
                            </div>
                            <div>
                                <div className="tiny muted">Address</div>
                                <div className="spotInfoValue">{booking?.spot_address ?? "—"}</div>
                            </div>
                            <div>
                                <div className="tiny muted">When</div>
                                <div className="spotInfoValue">
                                    {booking?.start_time && booking?.end_time
                                        ? `${booking.start_time} → ${booking.end_time}`
                                        : "—"}
                                </div>
                            </div>
                            <div>
                                <div className="tiny muted">Total</div>
                                <div className="spotInfoValue">
                                    {booking?.total_price_gbp != null ? `£${Number(booking.total_price_gbp).toFixed(2)}` : "—"}
                                </div>
                            </div>
                            <div>
                                <div className="tiny muted">Payment method</div>
                                <div className="spotInfoValue">Card</div>
                            </div>
                        </div>
                    </div>

                    <Elements stripe={stripePromise} options={{ clientSecret }}>
                        <CardForm
                            bookingId={id}
                            clientSecret={clientSecret}
                            token={token}
                            onPaid={async () => {
                                setPaid(true);
                                await loadReceipt();
                            }}
                        />
                    </Elements>
                </>
            )}

            {paid && (
                <div className="card formSection">
                    <div className="h3">Payment confirmed</div>
                    <div className="muted" style={{ marginTop: 6 }}>
                        Your payment was successful. Here’s your receipt:
                    </div>

                    <div className="spotInfoGrid" style={{ marginTop: 10 }}>
                        <div>
                            <div className="tiny muted">Booking ID</div>
                            <div className="spotInfoValue">{id}</div>
                        </div>
                        <div>
                            <div className="tiny muted">Status</div>
                            <div className="spotInfoValue">Paid</div>
                        </div>
                        <div>
                            <div className="tiny muted">Spot</div>
                            <div className="spotInfoValue">{receipt?.spot_title ?? "—"}</div>
                        </div>
                        <div>
                            <div className="tiny muted">Address</div>
                            <div className="spotInfoValue">{receipt?.spot_address ?? "—"}</div>
                        </div>
                        <div>
                            <div className="tiny muted">Start</div>
                            <div className="spotInfoValue">{receipt?.start_time ?? "—"}</div>
                        </div>
                        <div>
                            <div className="tiny muted">End</div>
                            <div className="spotInfoValue">{receipt?.end_time ?? "—"}</div>
                        </div>
                        <div>
                            <div className="tiny muted">Amount</div>
                            <div className="spotInfoValue">
                                {receipt?.total_price_gbp != null ? `£${Number(receipt.total_price_gbp).toFixed(2)}` : "—"}
                            </div>
                        </div>
                        <div>
                            <div className="tiny muted">Payment method</div>
                            <div className="spotInfoValue">{receipt?.pay_method ?? "card"}</div>
                        </div>
                    </div>

                    <div className="rowInline" style={{ marginTop: 10 }}>
                        <Link to="/dashboard" className="btn btn-primary">Go to dashboard</Link>
                        <Link to="/" className="btn">Back to home</Link>
                    </div>
                </div>
            )}
        </div>
    );
}
