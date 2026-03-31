import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router-dom";
import Lottie from "lottie-react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { apiGet, apiPost, readErrorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import AppPageState from "../components/AppPageState";
import { ReceiptCard, ReceiptDivider, ReceiptRow } from "../components/ReceiptCard";
import { buildStripeElementsOptions } from "../lib/stripeElements";
import loadingAnimation from "../assets/loading.json";
import { formatDateRangeLocal, formatDateTimeLocal, formatGbp, STRIPE_MIN_GBP_PAYMENT, toFiniteNumber } from "./pagesShared";

type Booking = {
    id: string;
    parking_spot_id?: string | null;
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
    payment_status?: string;
};

type StripeIntentDetails = {
    client_secret: string | null;
    payment_intent_id: string;
    payment_intent_status?: string | null;
};

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string);
const POUND = String.fromCharCode(163);
const SECURE_PAYMENT_NOTICE = "Enter your details in Stripe's secure payment form. Once payment succeeds, you will be sent straight to the Stripe receipt.";

function sleep(ms: number) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function renderMutedReceiptCopy(text: string) {
    return <span className="tiny muted">{text}</span>;
}

async function fetchBookingReceipt(bookingId: string, token: string) {
    const response = await apiGet<{ receipt: StripeReceiptDetails; payment_status?: string }>(
        `/payments/booking/${bookingId}/receipt`,
        token
    );
    if (!response.receipt) return null;
    return {
        ...response.receipt,
        payment_status: response.payment_status ?? response.receipt.payment_status,
    };
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
    clientSecret,
    onError,
    onProcessingChange,
    onPaymentSubmitted,
}: {
    booking: Booking;
    token: string;
    clientSecret: string;
    onError: (message: string | null) => void;
    onProcessingChange: (value: boolean) => void;
    onPaymentSubmitted: () => Promise<void>;
}) {
    const stripe = useStripe();
    const elements = useElements();
    const [busy, setBusy] = useState(false);

    async function confirmPayment() {
        if (!stripe || !elements) {
            onError("Secure payment form is not ready yet.");
            return;
        }

        const { error: submitError } = await elements.submit();
        if (submitError) {
            onError(submitError.message ?? "Please complete your payment details.");
            return;
        }

        setBusy(true);
        onProcessingChange(true);
        onError(null);

        try {
            const result = await stripe.confirmPayment({
                elements,
                clientSecret,
                redirect: "if_required",
            });
            if (result.error) {
                onError(result.error.message ?? "Card payment failed.");
                onProcessingChange(false);
                return;
            }

            await onPaymentSubmitted();
            const receiptUrl = await waitForStripeReceiptUrl(booking.id, token);
            if (receiptUrl) {
                window.location.href = receiptUrl;
                return;
            }
        } catch (error: unknown) {
            onError(readErrorMessage(error, "Unable to complete payment."));
            onProcessingChange(false);
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="card formSection" style={{ marginTop: 14, marginBottom: 14 }}>
            <div className="h3">Secure card payment</div>
            <div className="spotAlert">
                {SECURE_PAYMENT_NOTICE}
            </div>
            <div style={{border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, marginTop: 12, minHeight: 230 }}>
                <PaymentElement />
            </div>
            <div className="rowInline">
                <button className="btn btn-primary" onClick={confirmPayment} disabled={busy} style={{marginLeft: 6}}>
                    {busy ? "Processing..." : "Confirm Payment "}
                </button>
            </div>
        </div>
    );
}

function BookingPaymentSection({
    booking,
    token,
    onError,
    onProcessingChange,
    onPaymentSubmitted,
}: {
    booking: Booking;
    token: string;
    onError: (message: string | null) => void;
    onProcessingChange: (value: boolean) => void;
    onPaymentSubmitted: () => Promise<void>;
}) {
    const [intent, setIntent] = useState<StripeIntentDetails | null>(null);
    const [intentLoading, setIntentLoading] = useState(true);
    const paymentIntentStatus = String(intent?.payment_intent_status ?? "").toLowerCase();

    useEffect(() => {
        let active = true;
        setIntent(null);
        setIntentLoading(true);
        onError(null);

        apiPost<StripeIntentDetails>("/payments/booking-intent", { booking_id: booking.id }, token)
            .then((response) => {
                if (active) setIntent(response);
            })
            .catch((error: unknown) => {
                if (active) onError(readErrorMessage(error, "Unable to prepare secure payment."));
            })
            .finally(() => {
                if (active) setIntentLoading(false);
            });

        return () => {
            active = false;
        };
    }, [booking.id, onError, token]);

    if (!intent) {
        return (
            <div className="card formSection" style={{ marginTop: 14, marginBottom: 14 }}>
                <div className="h3">Secure card payment</div>
                <div className="muted" style={{ marginTop: 6 }}>
                    {intentLoading ? "Preparing Stripe's secure payment form..." : "The secure payment form is unavailable right now."}
                </div>
            </div>
        );
    }

    if (paymentIntentStatus === "processing" || paymentIntentStatus === "succeeded") {
        return (
            <div className="card formSection" style={{ marginTop: 14, marginBottom: 14 }}>
                <div className="h3">Secure card payment</div>
                <div className="muted" style={{ marginTop: 6 }}>
                    Your payment is already being finalized. We are checking Stripe and will update this page as soon as it is ready.
                </div>
            </div>
        );
    }

    if (!intent.client_secret) {
        return (
            <div className="card formSection" style={{ marginTop: 14, marginBottom: 14 }}>
                <div className="h3">Secure card payment</div>
                <div className="muted" style={{ marginTop: 6 }}>
                    The secure payment form is not ready yet. Please refresh and try again in a moment.
                </div>
            </div>
        );
    }

    return (
        <Elements stripe={stripePromise} options={buildStripeElementsOptions(intent.client_secret)}>
            <BookingCardForm
                booking={booking}
                token={token}
                clientSecret={intent.client_secret}
                onError={onError}
                onProcessingChange={onProcessingChange}
                onPaymentSubmitted={onPaymentSubmitted}
            />
        </Elements>
    );
}

export default function PayBookingPage() {
    const { bookingId } = useParams();
    const { token, user } = useAuth();
    const queryClient = useQueryClient();
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
    const bookingMoneyBelowMinimum =
        booking?.pay_method === "money" &&
        toFiniteNumber(booking?.total_price_gbp) > 0 &&
        toFiniteNumber(booking?.total_price_gbp) < STRIPE_MIN_GBP_PAYMENT;
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
    const receiptPaymentStatus = String(receiptQuery.data?.payment_status ?? "").toLowerCase();

    const paymentComplete =
        booking?.pay_method !== "money" ||
        paymentMarkedSucceeded ||
        receiptPaymentStatus === "succeeded" ||
        Boolean(receiptQuery.data?.receipt_url) ||
        String(booking?.status ?? "").toLowerCase() === "confirmed" ||
        toFiniteNumber(booking?.total_price_gbp) <= 0;
    const requiresPayment = paymentPending && !paymentComplete && !bookingMoneyBelowMinimum;
    const shouldPollReceipt =
        Boolean(token) &&
        Boolean(id) &&
        Boolean(shouldFetchReceipt) &&
        booking?.pay_method === "money" &&
        paymentComplete &&
        !receiptQuery.data?.receipt_url;

    async function refreshPaymentState() {
        await bookingQuery.refetch();
        await receiptQuery.refetch();
        await queryClient.invalidateQueries({ queryKey: ["notification-summary"] });
    }

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

    useEffect(() => {
        if (paymentComplete) {
            setProcessingPayment(false);
            setErr(null);
            return;
        }
        if (receiptPaymentStatus === "failed") {
            setProcessingPayment(false);
            setErr((current) => current ?? "Payment was not completed. Please check your details and try again.");
        }
    }, [paymentComplete, receiptPaymentStatus]);

    if (!token) return <Navigate to="/login" replace />;

    const loadErr = bookingQuery.error ? readErrorMessage(bookingQuery.error, "Could not load payment details.") : null;
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
    const contactLockedByPayment = booking?.pay_method === "money" && requiresPayment;
    const ownerContactPendingCopy = "Details will be shown after payment is complete.";
    const dashboardPath = "/dashboard?tab=myBookings";

    function getOwnerContactValue(value: string) {
        if (contactLockedByPayment) {
            return renderMutedReceiptCopy(ownerContactPendingCopy);
        }
        if (value) return value;
        return renderMutedReceiptCopy("Not provided.");
    }

    const stripeSummary = hasStripeReceipt
        ? [
            { label: "Amount received", value: `${POUND}${amountReceived.toFixed(2)}` },
            { label: "Payment intent", value: receipt?.payment_intent_id ?? "-" },
            { label: "Charge ID", value: receipt?.charge_id ?? "-" },
            { label: "Booked at", value: bookedAt },
        ]
        : [];
    const showPaymentSuccessNotice = !requiresPayment && booking?.pay_method === "money" && paymentComplete;
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
            {showPaymentSuccessNotice ? (
                <div className="paymentSuccessNotice">
                    <div className="h3">Booking confirmed</div>
                    <div className="createFieldHint">You're all set. Your new booking is ready below in Manage bookings.</div>
                </div>
            ) : (
                <div className="pageHeader">
                    <div className="heroKicker">{pageKicker}</div>
                    <div className="heroTitle">{pageTitle}</div>
                    <div className="heroSub muted">{pageSubtitle}</div>
                </div>
            )}

            {loadErr && (
                <AppPageState
                    card
                    title="This checkout took a detour."
                    copy="The booking details did not load properly. Head back home and try again in a moment."
                />
            )}
            {err && <div className="spotAlert" style={{ marginBottom: 14, color: "#9f2f45", borderColor: "#f1c7d1", background: "#fff4f6" }}>{err}</div>}

            {!loadErr && booking && (
                <>
                    <ReceiptCard
                        kicker={showPaymentSuccessNotice ? "" : "PARKINGBUDDIES"}
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
                        <ReceiptDivider />
                        <ReceiptRow label="Owner email" value={getOwnerContactValue(ownerContactEmail)} />
                        <ReceiptRow label="Owner phone" value={getOwnerContactValue(ownerContactPhone)} />
                        <ReceiptRow label="Arrival notes" value={getOwnerContactValue(ownerContactInfo)} />
                    </ReceiptCard>

                    {requiresPayment && (
                        <BookingPaymentSection
                            booking={booking}
                            token={token}
                            onError={setErr}
                            onProcessingChange={setProcessingPayment}
                            onPaymentSubmitted={refreshPaymentState}
                        />
                    )}
                    {bookingMoneyBelowMinimum && (
                        <div className="card formSection" style={{ marginTop: 14, marginBottom: 14 }}>
                            <div className="h3">Secure card payment</div>
                            <div className="muted" style={{ marginTop: 6 }}>
                                Card payments in GBP must be at least {formatGbp(STRIPE_MIN_GBP_PAYMENT)}.
                                This booking totals {formatGbp(booking.total_price_gbp)}, so Stripe cannot open the payment form for it.
                                Please return to the listing and pick a longer slot or use points instead.
                            </div>
                        </div>
                    )}



                    {!requiresPayment && !bookingMoneyBelowMinimum && (
                        <div className="receiptActions" style={{ marginTop: 12 }}>
                            <div className="actionInlineGrid">
                                <Link to={dashboardPath} className="btn">View booking</Link>
                                {hasStripeReceipt ? (
                                    <a
                                        href={receipt?.receipt_url ?? undefined}
                                        className="btn"
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        Stripe receipt
                                    </a>
                                ) : null}
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
