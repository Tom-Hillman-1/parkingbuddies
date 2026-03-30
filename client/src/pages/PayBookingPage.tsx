import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router-dom";
import Lottie from "lottie-react";
import { loadStripe } from "@stripe/stripe-js";
import { CardElement, Elements, useElements, useStripe } from "@stripe/react-stripe-js";
import { apiGet, apiPost, readErrorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ReceiptCard, ReceiptDivider, ReceiptRow } from "../components/ReceiptCard";
import loadingAnimation from "../assets/loading.json";
import { formatDateRangeLocal, formatDateTimeLocal, toFiniteNumber } from "./pagesShared";

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
    created_at?: string;
    payment_provider_ref?: string | null;
    payment_status?: string | null;
    owner_contact_email?: string | null;
    owner_contact_phone?: string | null;
    owner_contact_info?: string | null;
};

type StripeReceiptDetails = {
    receipt_url: string | null;
    amount_received_gbp?: number;
    payment_intent_id?: string;
    charge_id?: string | null;
};

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string);
const POUND = String.fromCharCode(163);

function sleep(ms: number) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fetchBookingReceipt(bookingId: string, token: string) {
    const response = await apiGet<{ receipt: StripeReceiptDetails }>(`/payments/booking/${bookingId}/receipt`, token);
    return response.receipt ?? null;
}

async function waitForStripeReceiptUrl(bookingId: string, token: string, attempts = 6) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const receipt = await fetchBookingReceipt(bookingId, token);
        const url = receipt?.receipt_url;
        if (url) return url;
        if (attempt < attempts - 1) await sleep(1200);
    }
    return null;
}

function BookingCardForm({
    booking,
    token,
    onError,
    onProcessingChange,
}: {
    booking: Booking;
    token: string;
    onError: (message: string | null) => void;
    onProcessingChange: (value: boolean) => void;
}) {
    const stripe = useStripe();
    const elements = useElements();
    const [busy, setBusy] = useState(false);

    async function confirmPayment() {
        if (!stripe || !elements) {
            onError("Card form is not ready yet.");
            return;
        }

        const card = elements.getElement(CardElement);
        if (!card) {
            onError("Card form is not available.");
            return;
        }

        setBusy(true);
        onProcessingChange(true);
        onError(null);

        try {
            const intent = await apiPost<{ client_secret: string; payment_intent_id: string }>(
                "/payments/booking-intent",
                { booking_id: booking.id },
                token
            );

            const result = await stripe.confirmCardPayment(intent.client_secret, {
                payment_method: { card },
            });
            if (result.error) {
                onError(result.error.message ?? "Card payment failed.");
                onProcessingChange(false);
                return;
            }

            const receiptUrl = await waitForStripeReceiptUrl(booking.id, token);
            if (receiptUrl) {
                window.location.href = receiptUrl;
                return;
            }

            window.location.href = `/pay/${booking.id}`;
        } catch (error: unknown) {
            onError(readErrorMessage(error, "Unable to complete payment."));
            onProcessingChange(false);
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="card formSection" style={{ marginTop: 14, marginBottom: 14 }}>
            <div className="h3">Pay by card</div>
            <div className="muted" style={{ marginTop: 6 }}>
                Enter your card details below. Once payment succeeds, you will be sent straight to the Stripe receipt.
            </div>
            <div style={{ padding: 12, border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, marginTop: 12 }}>
                <CardElement options={{ hidePostalCode: true }} />
            </div>
            <div className="rowInline" style={{ marginTop: 12 }}>
                <button className="btn btn-primary" onClick={confirmPayment} disabled={busy}>
                    {busy ? "Processing..." : "Pay now"}
                </button>
            </div>
        </div>
    );
}

export default function PayBookingPage() {
    const { bookingId } = useParams();
    const { token, user } = useAuth();
    const [err, setErr] = useState<string | null>(null);
    const [processingPayment, setProcessingPayment] = useState(false);

    const id = bookingId ?? "";

    const bookingQuery = useQuery({
        queryKey: ["booking-payment", id, token],
        enabled: Boolean(token && id),
        queryFn: async () => {
            if (!token || !id) throw new Error("Missing booking details.");
            const bookingRes = await apiGet<{ booking: Booking }>(`/bookings/${id}`, token);
            return bookingRes.booking;
        },
    });

    const booking = bookingQuery.data ?? null;
    const isPointsBooking = booking?.pay_method === "points";
    const isFreeBooking = booking?.pay_method === "money" && toFiniteNumber(booking?.total_price_gbp) <= 0;
    const paymentMarkedSucceeded = String(booking?.payment_status ?? "").toLowerCase() === "succeeded";
    const paymentPending = useMemo(() => {
        if (!booking) return false;
        return booking.pay_method === "money" && booking.status === "pending" && toFiniteNumber(booking.total_price_gbp) > 0;
    }, [booking]);

    const shouldFetchReceipt = useMemo(() => {
        if (!booking) return false;
        const hasProviderRef =
            typeof booking.payment_provider_ref === "string" &&
            booking.payment_provider_ref.trim().length > 0;
        return booking.pay_method === "money" && (hasProviderRef || !paymentPending);
    }, [booking, paymentPending]);

    const receiptQuery = useQuery({
        queryKey: ["booking-receipt", id, token],
        enabled: Boolean(token && id && shouldFetchReceipt),
        retry: false,
        queryFn: async () => {
            if (!token || !id) throw new Error("Missing receipt details.");
            return fetchBookingReceipt(id, token);
        },
    });

    const paymentComplete =
        booking?.pay_method !== "money" ||
        paymentMarkedSucceeded ||
        Boolean(receiptQuery.data?.receipt_url) ||
        String(booking?.status ?? "").toLowerCase() === "confirmed" ||
        toFiniteNumber(booking?.total_price_gbp) <= 0;
    const requiresPayment = paymentPending && !paymentComplete;
    const shouldPollReceipt =
        Boolean(token) &&
        Boolean(id) &&
        Boolean(shouldFetchReceipt) &&
        booking?.pay_method === "money" &&
        paymentComplete &&
        !receiptQuery.data?.receipt_url;

    useEffect(() => {
        if (!shouldPollReceipt) return;
        const timer = window.setInterval(() => {
            void receiptQuery.refetch();
            void bookingQuery.refetch();
        }, 2500);
        return () => {
            window.clearInterval(timer);
        };
    }, [shouldPollReceipt, receiptQuery, bookingQuery]);

    if (!token) return <Navigate to="/login" replace />;

    const loadErr = bookingQuery.error ? readErrorMessage(bookingQuery.error, "Could not load payment details.") : null;
    const loading = bookingQuery.isLoading;
    const receipt = receiptQuery.data ?? null;

    const hasStripeReceipt = Boolean(receipt?.receipt_url);
    const bookingTitle = booking?.spot_title ?? "Parking booking";
    const bookingAddress = booking?.spot_address ?? "Address on file";
    const bookingWindow = booking ? formatDateRangeLocal(booking.start_time, booking.end_time) : "Time on file";
    const bookedAt = formatDateTimeLocal(booking?.created_at);
    const amountReceived = toFiniteNumber(receipt?.amount_received_gbp);
    const ownerContactEmail = String(booking?.owner_contact_email ?? "").trim();
    const ownerContactPhone = String(booking?.owner_contact_phone ?? "").trim();
    const ownerContactInfo = String(booking?.owner_contact_info ?? "").trim();
    const hasOwnerContact = Boolean(ownerContactEmail || ownerContactPhone || ownerContactInfo);
    const contactLockedByPayment = booking?.pay_method === "money" && requiresPayment;

    const stripeSummary = hasStripeReceipt
        ? [
            { label: "Amount received", value: `${POUND}${amountReceived.toFixed(2)}` },
            { label: "Payment intent", value: receipt?.payment_intent_id ?? "-" },
            { label: "Charge ID", value: receipt?.charge_id ?? "-" },
            { label: "Booked at", value: bookedAt },
        ]
        : [];
    const pageKicker = requiresPayment ? "PAYMENT" : isPointsBooking ? "POINTS" : "BOOKING";
    const pageTitle = requiresPayment ? "Complete booking" : "Booking confirmed";
    const pageSubtitle = requiresPayment
        ? "Review the booking and pay securely with your card."
        : isPointsBooking
            ? "Review the points used for this booking."
            : "Review the details for your confirmed booking.";
    const localSummaryTitle = isPointsBooking ? "Points receipt" : "Booking receipt";
    const localSummarySubtitle = isPointsBooking
        ? "Points were used for this booking and have been applied to the listing."
        : isFreeBooking
            ? "This booking was confirmed without any payment."
            : "Booking details recorded locally by ParkingBuddies.";

    return (
        <div className="container">
            <div className="pageHeader">
                <div className="heroKicker">{pageKicker}</div>
                <div className="heroTitle">{pageTitle}</div>
                <div className="heroSub muted">{pageSubtitle}</div>
            </div>

            {loading && <div className="card formSection">Loading payment details...</div>}
            {(err ?? loadErr) && <div className="card formSection" style={{ color: "crimson" }}>{err ?? loadErr}</div>}

            {!loading && !loadErr && booking && (
                <>
                    <ReceiptCard
                        kicker="PARKINGBUDDIES"
                        title={
                            requiresPayment
                                ? "Booking summary"
                                : booking.pay_method === "money" && hasStripeReceipt
                                    ? "Booking and payment receipt"
                                    : localSummaryTitle
                        }
                        subtitle={
                            requiresPayment
                                ? "Your booking details are saved locally while payment is still pending."
                                : booking.pay_method === "money" && hasStripeReceipt
                                    ? "Booking details recorded locally with Stripe payment confirmation."
                                : localSummarySubtitle
                        }
                        className="receiptCard--confirm payReceiptCard"
                        actions={
                            <>
                                {!requiresPayment && booking.pay_method === "money" && hasStripeReceipt && (
                                    <a
                                        className="btn btn-primary"
                                        href={receipt?.receipt_url ?? undefined}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        Open Stripe receipt
                                    </a>
                                )}
                                <Link to="/dashboard?tab=myBookings" className="btn btn-primary">Back to dashboard</Link>
                                <Link to="/about#contact-bottom" className="btn">Contact support</Link>
                            </>
                        }
                    >
                        <ReceiptRow label="Booking" value={bookingTitle} />
                        <ReceiptRow label="Location" value={bookingAddress} />
                        <ReceiptRow label="Window" value={bookingWindow} />
                        <ReceiptRow
                            label={isPointsBooking ? "Points used" : "Amount"}
                            value={isPointsBooking ? `${booking.total_points ?? 0} pts` : `${POUND}${toFiniteNumber(booking.total_price_gbp).toFixed(2)}`}
                        />
                        {isPointsBooking && <ReceiptRow label="Balance after payment" value={`${user?.points_balance ?? 0} pts`} />}
                        <ReceiptRow label="Status" value={String(booking.status ?? "confirmed")} />
                        <ReceiptRow label="Booked at" value={bookedAt} />
                        {!requiresPayment && booking.pay_method === "money" && hasStripeReceipt && (
                            <>
                                <ReceiptDivider />
                                {stripeSummary.map((row) => (
                                    <ReceiptRow key={row.label} label={row.label} value={row.value} />
                                ))}
                            </>
                        )}
                    </ReceiptCard>

                    {requiresPayment && (
                        <Elements stripe={stripePromise} options={{}}>
                            <BookingCardForm
                                booking={booking}
                                token={token}
                                onError={setErr}
                                onProcessingChange={setProcessingPayment}
                            />
                        </Elements>
                    )}

                    {hasOwnerContact && (
                        <div style={{ marginTop: 14 }}>
                            <ReceiptCard
                                kicker="HOST DETAILS"
                                title="Owner contact"
                                subtitle="Shared after your booking is placed."
                                className="receiptCard--confirm"
                            >
                                {ownerContactEmail && <ReceiptRow label="Owner email" value={ownerContactEmail} />}
                                {ownerContactPhone && <ReceiptRow label="Owner phone" value={ownerContactPhone} />}
                                {ownerContactInfo && <ReceiptRow label="Arrival notes" value={ownerContactInfo} />}
                            </ReceiptCard>
                        </div>
                    )}

                    {contactLockedByPayment && (
                        <div className="card formSection" style={{ marginTop: 14 }}>
                            <div className="h3">Owner contact unlocks after payment</div>
                            <div className="muted" style={{ marginTop: 6 }}>
                                Private host details are shown once payment is fully completed.
                            </div>
                        </div>
                    )}

                </>
            )}

            {processingPayment && (
                <div className="createSuccessOverlay" role="status" aria-live="polite">
                    <section className="createSuccessCard">
                        <Lottie animationData={loadingAnimation} loop className="createSuccessAnimation" />
                        <div className="h3">Processing payment...</div>
                        <div className="createFieldHint">Confirming your card payment and opening the Stripe receipt.</div>
                    </section>
                </div>
            )}
        </div>
    );
}
