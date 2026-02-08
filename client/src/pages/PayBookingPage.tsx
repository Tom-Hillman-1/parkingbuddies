import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { apiGet, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";

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
    receipt_url: string | null;
};

function money(value: unknown) {
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? n : 0;
}

export default function PayBookingPage() {
    const { bookingId } = useParams();
    const { token } = useAuth();
    const [booking, setBooking] = useState<Booking | null>(null);
    const [receipt, setReceipt] = useState<StripeReceiptDetails | null>(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const id = bookingId ?? "";
    const [searchParams] = useSearchParams();
    const successCheckout = searchParams.get("success") === "1";
    const sessionId = searchParams.get("session_id") ?? undefined;
    const receiptQueryString = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : "";

    const refreshReceipt = useCallback(async () => {
        if (!token || !id) return;
        try {
            const receiptRes = await apiGet<{ receipt: StripeReceiptDetails }>(
                `/payments/booking/${id}/receipt${receiptQueryString}`,
                token
            );
            setReceipt(receiptRes.receipt ?? null);
        } catch {
            // waiting for Stripe to post the receipt
        }
    }, [id, token, receiptQueryString]);

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
                const hasProviderRef =
                    typeof currentBooking.payment_provider_ref === "string" &&
                    currentBooking.payment_provider_ref.trim().length > 0;
                const shouldFetchReceipt =
                    currentBooking.pay_method === "money" &&
                    (hasProviderRef || !needsPayment || successCheckout);

                if (shouldFetchReceipt) {
                    await refreshReceipt();
                }
            } catch (e: any) {
                setErr(e?.message || "Could not load payment details.");
            } finally {
                setLoading(false);
            }
        })();
    }, [id, token, successCheckout, refreshReceipt]);

    useEffect(() => {
        if (!successCheckout || !booking || booking.pay_method !== "money" || receipt?.receipt_url) {
            return;
        }
        const timer = window.setInterval(() => {
            refreshReceipt();
        }, 2500);
        return () => {
            window.clearInterval(timer);
        };
    }, [successCheckout, booking?.pay_method, receipt?.receipt_url, refreshReceipt]);

    async function goToStripeCheckout() {
        if (!token || !booking) return;
        setBusy(true);
        setErr(null);
        try {
            const res = await apiPost<{ url: string }>("/payments/checkout-session", { booking_id: booking.id }, token);
            if (res?.url) {
                window.location.href = res.url;
                return;
            }
            setErr("Stripe checkout link was not available.");
        } catch (e: any) {
            setErr(e?.message || "Unable to start Stripe checkout.");
        } finally {
            setBusy(false);
        }
    }

    if (!token) return <Navigate to="/login" replace />;

    const receiptSubtitleText = successCheckout
        ? "Thanks for returning from Stripe. We'll show your official receipt here once it's ready."
        : booking?.payment_provider_ref
            ? "Stripe payment recorded. Open your official receipt below."
            : "Open your official Stripe receipt below.";
    const receiptWaitMessage = successCheckout
        ? "Stripe receipt link is still syncing. Please wait a moment and refresh if needed."
        : "Stripe receipt link is not available yet.";

    return (
        <div className="container">
            <div className="pageHeader">
                <div className="heroKicker">PAYMENT</div>
                <div className="heroTitle">Stripe checkout</div>
                <div className="heroSub muted">Pay securely, then open your official Stripe receipt.</div>
            </div>

            {loading && <div className="card formSection">Loading checkout...</div>}
            {err && <div className="card formSection" style={{ color: "crimson" }}>{err}</div>}

            {!loading && !err && booking && (
                <>
                {requiresPayment && !successCheckout && (
                    <div className="card formSection">
                        <div className="h3">Continue in Stripe</div>
                        <div className="muted" style={{ marginTop: 6 }}>
                            You will complete payment on Stripe and receive the official receipt there.
                        </div>
                        <div className="rowInline" style={{ marginTop: 12 }}>
                            <button className="btn btn-primary" onClick={goToStripeCheckout} disabled={busy}>
                                {busy ? "Opening Stripe…" : "Continue to Stripe checkout"}
                            </button>
                        </div>
                    </div>
                )}

                {requiresPayment && successCheckout && (
                    <div className="card formSection">
                        <div className="h3">Payment completed</div>
                        <div className="muted" style={{ marginTop: 6 }}>
                            Thanks for confirming payment on Stripe. We're syncing your official receipt now.
                        </div>
                    </div>
                )}

                {!requiresPayment && booking.pay_method === "money" && (
                    <div className="card formSection">
                        <div className="h3">Payment already completed</div>
                        <div className="muted" style={{ marginTop: 6 }}>
                            Open your official Stripe receipt below.
                        </div>
                    </div>
                )}

                {booking.pay_method === "money" && (
                    <div className="card formSection">
                        <div className="muted" style={{ marginTop: 6 }}>{receiptSubtitleText}</div>
                        <div className="rowInline" style={{ marginTop: 12 }}>
                            {receipt?.receipt_url ? (
                                <a
                                    className="btn btn-primary"
                                    href={receipt.receipt_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    Open Stripe receipt
                                </a>
                            ) : (
                                <span className="tiny muted">
                                    {receiptWaitMessage}
                                </span>
                            )}
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
