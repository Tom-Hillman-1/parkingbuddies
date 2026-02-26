import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { apiGet, apiPost, readErrorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ReceiptCard, ReceiptDivider, ReceiptRow } from "../components/ReceiptCard";
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

const POUND = String.fromCharCode(163);

export default function PayBookingPage() {
    const { bookingId } = useParams();
    const { token } = useAuth();
    const [searchParams] = useSearchParams();
    const [err, setErr] = useState<string | null>(null);

    const id = bookingId ?? "";
    const successCheckout = searchParams.get("success") === "1";
    const sessionId = searchParams.get("session_id") ?? undefined;
    const receiptQueryString = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : "";

    // credit: server-state loading pattern adapted from TanStack Query docs
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
    const requiresPayment = useMemo(() => {
        if (!booking) return false;
        return (
            booking.pay_method === "money" &&
            booking.status === "pending" &&
            toFiniteNumber(booking.total_price_gbp) > 0
        );
    }, [booking]);

    const shouldFetchReceipt = useMemo(() => {
        if (!booking) return false;
        const hasProviderRef =
            typeof booking.payment_provider_ref === "string" &&
            booking.payment_provider_ref.trim().length > 0;
        return booking.pay_method === "money" && (hasProviderRef || !requiresPayment || successCheckout);
    }, [booking, requiresPayment, successCheckout]);

    const receiptQuery = useQuery({
        queryKey: ["booking-receipt", id, token, receiptQueryString],
        enabled: Boolean(token && id && shouldFetchReceipt),
        retry: false,
        queryFn: async () => {
            if (!token || !id) throw new Error("Missing receipt details.");
            const receiptRes = await apiGet<{ receipt: StripeReceiptDetails }>(
                `/payments/booking/${id}/receipt${receiptQueryString}`,
                token
            );
            return receiptRes.receipt ?? null;
        },
    });
    const shouldPollReceipt = Boolean(
        successCheckout &&
        booking &&
        booking.pay_method === "money" &&
        !receiptQuery.data?.receipt_url
    );
    const refetchReceipt = receiptQuery.refetch;

    useEffect(() => {
        if (!shouldPollReceipt) return;
        const timer = window.setInterval(() => {
            void refetchReceipt();
        }, 2500);
        return () => {
            window.clearInterval(timer);
        };
    }, [shouldPollReceipt, refetchReceipt]);

    const checkoutMutation = useMutation({
        // credit: Stripe Checkout redirect pattern aligned to Stripe docs
        mutationFn: async () => {
            if (!token || !booking) throw new Error("Missing booking context.");
            return apiPost<{ url: string }>("/payments/checkout-session", { booking_id: booking.id }, token);
        },
        onSuccess: (response) => {
            if (response?.url) {
                window.location.href = response.url;
                return;
            }
            setErr("Stripe checkout link was not available.");
        },
        onError: (error: unknown) => {
            setErr(readErrorMessage(error, "Unable to start Stripe checkout."));
        },
    });

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
    const paymentMarkedSucceeded = String(booking?.payment_status ?? "").toLowerCase() === "succeeded";
    const paymentComplete =
        booking?.pay_method !== "money" ||
        paymentMarkedSucceeded ||
        hasStripeReceipt ||
        String(booking?.status ?? "").toLowerCase() === "confirmed" ||
        toFiniteNumber(booking?.total_price_gbp) <= 0;
    const contactLockedByPayment = booking?.pay_method === "money" && !paymentComplete;
    const contactSyncing = booking?.pay_method === "money" && paymentComplete && !hasOwnerContact;

    const stripeSummary = hasStripeReceipt
        ? [
            { label: "Amount received", value: `${POUND}${amountReceived.toFixed(2)}` },
            { label: "Payment intent", value: receipt?.payment_intent_id ?? "-" },
            { label: "Charge ID", value: receipt?.charge_id ?? "-" },
            { label: "Booked at", value: bookedAt },
        ]
        : [];

    return (
        <div className="container">
            <div className="pageHeader">
                <div className="heroKicker">STRIPE</div>
                <div className="heroTitle">Track booking</div>
                <div className="heroSub muted">Pay securely, then open your official Stripe receipt.</div>
            </div>

            {loading && <div className="card formSection">Loading checkout...</div>}
            {(err ?? loadErr) && <div className="card formSection" style={{ color: "crimson" }}>{err ?? loadErr}</div>}

            {!loading && !loadErr && booking && (
                <>
                    {requiresPayment && !successCheckout && (
                        <div className="card formSection" style={{ marginBottom: 14 }}>
                            <div className="h3">Continue in Stripe</div>
                            <div className="muted" style={{ marginTop: 6 }}>
                                You will complete payment on Stripe and receive the official receipt there.
                            </div>
                            <div className="rowInline" style={{ marginTop: 12 }}>
                                <button className="btn btn-primary" onClick={() => checkoutMutation.mutate()} disabled={checkoutMutation.isPending}>
                                    {checkoutMutation.isPending ? "Opening Stripe..." : "Continue to Stripe checkout"}
                                </button>
                            </div>
                        </div>
                    )}

                    {requiresPayment && successCheckout && (
                        <div className="card formSection" style={{ marginBottom: 14 }}>
                            <div className="h3">Payment completed successfully</div>
                            <div className="muted" style={{ marginTop: 6 }}>
                                Thanks for confirming payment on Stripe. We are syncing your official receipt now.
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

                    {booking.pay_method === "money" && hasStripeReceipt && (
                        <ReceiptCard
                            kicker="STRIPE RECEIPT"
                            title="Official summary"
                            subtitle="Details provided directly by Stripe."
                            className="receiptCard--confirm"
                            actions={
                                <>
                                    <a
                                        className="btn btn-primary"
                                        href={receipt?.receipt_url ?? undefined}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        Open Stripe receipt
                                    </a>
                                    <Link to="/dashboard" className="btn">Back to dashboard</Link>
                                    <Link to="/about#contact-us" className="btn">Contact support</Link>
                                </>
                            }
                        >
                            <ReceiptRow label="Booking" value={bookingTitle} />
                            <ReceiptRow label="Location" value={bookingAddress} />
                            <ReceiptRow label="Window" value={bookingWindow} />
                            <ReceiptRow
                                label="Amount"
                                value={`${POUND}${toFiniteNumber(booking.total_price_gbp).toFixed(2)}`}
                            />
                            <ReceiptDivider />
                            {stripeSummary.map((row) => (
                                <ReceiptRow key={row.label} label={row.label} value={row.value} />
                            ))}
                        </ReceiptCard>
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

                    {contactSyncing && (
                        <div className="card formSection" style={{ marginTop: 14 }}>
                            <div className="h3">Payment confirmed, contact syncing</div>
                            <div className="muted" style={{ marginTop: 6 }}>
                                Your payment is complete. Owner contact details will appear here shortly.
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
