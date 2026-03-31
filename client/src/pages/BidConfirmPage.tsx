import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { apiGet, apiPost, readErrorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ReceiptCard, ReceiptRow } from "../components/ReceiptCard";
import { buildStripeElementsOptions } from "../lib/stripeElements";
import {
    calcAuctionMoneyTotal,
    calcAuctionPointsTotal,
    calcAuctionUnitsForRange,
    formatDateTimeCompact,
    formatGbp,
    STRIPE_MIN_GBP_PAYMENT,
    type PriceUnit,
} from "./pagesShared";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string);
type SpotSummary = { id: string; title: string; address_text: string; price_unit?: PriceUnit };
type StripeIntentDetails = { client_secret: string; payment_intent_id: string };

function useQueryValue(key: string, fallback = "") {
    const [search] = useSearchParams();
    return search.get(key) ?? fallback;
}

function buildIntentKey(spotId: string, start: string, end: string, amountGbp: number) {
    const normalizedStart = start.replace(/[^0-9A-Za-z]/g, "");
    const normalizedEnd = end.replace(/[^0-9A-Za-z]/g, "");
    const amount = Math.round(amountGbp * 100);
    return `bid_${spotId}_${normalizedStart}_${normalizedEnd}_${amount}`;
}

function BidCardForm({
    spotId,
    amountGbp,
    paymentIntentId,
    clientSecret,
    start,
    end,
    token,
    onBack,
    onDone,
    onError,
}: {
    spotId: string;
    amountGbp: number;
    paymentIntentId: string;
    clientSecret: string;
    start: string;
    end: string;
    token: string;
    onBack: string;
    onDone: (bidId: string) => void;
    onError: (msg: string | null) => void;
}) {
    const stripe = useStripe();
    const elements = useElements();
    const [busy, setBusy] = useState(false);

    async function confirm() {
        setBusy(true);
        onError(null);
        let bidSubmitted = false;
        try {
            if (!stripe || !elements) {
                onError("Secure authorization form is not ready yet.");
                return;
            }

            const { error: submitError } = await elements.submit();
            if (submitError) {
                onError(submitError.message ?? "Please complete your payment details.");
                return;
            }

            const result = await stripe.confirmPayment({
                elements,
                clientSecret,
                redirect: "if_required",
            });
            if (result.error) {
                onError(result.error.message ?? "Card authorization failed");
                return;
            }

            const confirmedPaymentIntentId = result.paymentIntent?.id ?? paymentIntentId;
            const confirmedStatus = result.paymentIntent?.status ?? null;
            if (confirmedStatus && confirmedStatus !== "requires_capture") {
                onError("Card authorization is still being finalized. Please try again in a moment.");
                return;
            }

            const response = await apiPost<{ bid_id: string }>(
                `/auctions/${spotId}/bid`,
                {
                    amount_gbp: amountGbp,
                    payment_intent_id: confirmedPaymentIntentId,
                    start_time: start,
                    end_time: end,
                    pay_method: "money",
                },
                token
            );
            bidSubmitted = true;
            onDone(response.bid_id);
        } catch (error: unknown) {
            if (!bidSubmitted) {
                try {
                    await apiPost("/payments/auction-intent/cancel", { payment_intent_id: paymentIntentId }, token);
                } catch {
                    // Best-effort cleanup only.
                }
            }
            onError(readErrorMessage(error, "Authorization failed"));
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="card" style={{ padding: 16, marginTop: 12 }}>
            <div className="h3">Secure card authorization</div>
            <div className="tiny muted" style={{ marginTop: 4 }}>
                Enter your details in Stripe's secure payment form. The amount is only charged if the owner accepts your bid.
            </div>
            <div style={{ padding: 10, border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, marginTop: 10 }}>
                <PaymentElement />
            </div>
            <div className="actionInlineGrid" style={{ marginTop: 12 }}>
                <button
                    onClick={confirm}
                    disabled={busy}
                    className="btn btn-primary"
                >
                    {busy ? "Authorizing..." : "Confirm & authorize"}
                </button>
                <Link to={onBack} className="btn">Back to listing</Link>
            </div>
        </div>
    );
}

function BidPaymentSection({
    amountGbp,
    spotId,
    start,
    end,
    token,
    onBack,
    onDone,
    onError,
}: {
    amountGbp: number;
    spotId: string;
    start: string;
    end: string;
    token: string;
    onBack: string;
    onDone: (bidId: string) => void;
    onError: (msg: string | null) => void;
}) {
    const [intent, setIntent] = useState<StripeIntentDetails | null>(null);
    const [intentLoading, setIntentLoading] = useState(true);
    const intentKey = useMemo(() => buildIntentKey(spotId, start, end, amountGbp), [amountGbp, end, spotId, start]);

    useEffect(() => {
        if (!Number.isFinite(amountGbp) || amountGbp <= 0) {
            setIntent(null);
            setIntentLoading(false);
            return;
        }

        let active = true;
        setIntent(null);
        setIntentLoading(true);
        onError(null);

        apiPost<StripeIntentDetails>(
            "/payments/auction-intent",
            {
                spot_id: spotId,
                amount_gbp: amountGbp,
                idempotency_key: intentKey,
            },
            token
        )
            .then((response) => {
                if (active) setIntent(response);
            })
            .catch((error: unknown) => {
                if (active) onError(readErrorMessage(error, "Unable to prepare secure authorization."));
            })
            .finally(() => {
                if (active) setIntentLoading(false);
            });

        return () => {
            active = false;
        };
    }, [amountGbp, intentKey, onError, spotId, token]);

    if (!intent) {
        return (
            <div className="card formSection" style={{ padding: 16, marginTop: 12 }}>
                <div className="h3">Secure card authorization</div>
                <div className="tiny muted" style={{ marginTop: 4 }}>
                    {intentLoading ? "Preparing Stripe's secure authorization form..." : "The secure authorization form is unavailable right now."}
                </div>
            </div>
        );
    }

    return (
        <Elements stripe={stripePromise} options={buildStripeElementsOptions(intent.client_secret)}>
            <BidCardForm
                spotId={spotId}
                amountGbp={amountGbp}
                paymentIntentId={intent.payment_intent_id}
                clientSecret={intent.client_secret}
                start={start}
                end={end}
                token={token}
                onBack={onBack}
                onDone={onDone}
                onError={onError}
            />
        </Elements>
    );
}

export default function BidConfirmPage() {
    const { token } = useAuth();
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    const spotId = useQueryValue("spotId");
    const start = useQueryValue("start");
    const end = useQueryValue("end");
    const pay = useQueryValue("pay", "money") as "money" | "points";
    const moneyPerUnitPrimary = useQueryValue("moneyPerUnit");
    const moneyPerUnitLegacy = useQueryValue("perHour");
    const pointsPerUnitPrimary = useQueryValue("pointsPerUnit");
    const pointsPerUnitLegacy = useQueryValue("pointsPerHour");
    const moneyPerUnit = moneyPerUnitPrimary || moneyPerUnitLegacy;
    const pointsPerUnit = pointsPerUnitPrimary || pointsPerUnitLegacy;

    const [err, setErr] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const handleMoneyBidError = useCallback((message: string | null) => {
        setErr(message ? message : null);
    }, []);
    const handleMoneyBidDone = useCallback((bidId: string) => {
        void queryClient.invalidateQueries({ queryKey: ["notification-summary"] });
        navigate(`/bids/${bidId}`);
    }, [navigate, queryClient]);
    const spotQuery = useQuery({
        queryKey: ["bid-confirm-spot", spotId],
        enabled: Boolean(spotId),
        queryFn: async () => {
            const response = await apiGet<{ parking_spot: SpotSummary }>(`/parking-spots/${spotId}`);
            return response.parking_spot ?? null;
        },
    });
    const spot = spotQuery.data ?? null;
    const unit = (spot?.price_unit ?? "hour") as PriceUnit;

    const units = useMemo(() => calcAuctionUnitsForRange(start, end, unit), [end, start, unit]);

    const totalMoney = useMemo(() => {
        return calcAuctionMoneyTotal(moneyPerUnit, units);
    }, [moneyPerUnit, units]);
    const totalPoints = useMemo(() => {
        return calcAuctionPointsTotal(pointsPerUnit, units);
    }, [pointsPerUnit, units]);

    if (!token) return <Navigate to="/login" replace />;
    if (!spotId || !start || !end) {
        return <Navigate to="/" replace />;
    }

    async function confirmPoints() {
        if (!token || !spotId) return;
        const pts = Number(pointsPerUnit);
        if (!Number.isFinite(pts) || pts <= 0) {
            setErr(`Enter a valid points amount per ${unit}.`);
            return;
        }
        setBusy(true);
        setErr(null);
        try {
            const response = await apiPost<{ bid_id: string }>(
                `/auctions/${spotId}/bid`,
                {
                    amount_points: pts,
                    start_time: start,
                    end_time: end,
                    pay_method: "points",
                },
                token
            );
            await queryClient.invalidateQueries({ queryKey: ["notification-summary"] });
            navigate(`/bids/${response.bid_id}`);
        } catch (error: unknown) {
            setErr(readErrorMessage(error, "Bid failed"));
        } finally {
            setBusy(false);
        }
    }

    const totalLabel = pay === "points" ? `${totalPoints} pts` : formatGbp(totalMoney);
    const perUnitLabel =
        pay === "points" ? `${Number(pointsPerUnit || 0)} pts` : formatGbp(moneyPerUnit);
    const moneyBidBelowMinimum = pay === "money" && totalMoney > 0 && totalMoney < STRIPE_MIN_GBP_PAYMENT;

    return (
        <div className="container">
            <div className="pageHeader">
                <div className="heroKicker">CONFIRMATION</div>
                <div className="heroTitle">Confirm your bid</div>
                <div className="heroSub muted">Review the details before you authorize.</div>
            </div>

            {err && <div className="card formSection" style={{ color: "crimson" }}>{err}</div>}

            <ReceiptCard
                kicker="PARKINGBUDDIES"
                title="Bid receipt"
                subtitle="Pending owner approval"
            >
                <ReceiptRow label="Listing" value={spot?.title ?? "Auction listing"} />
                <ReceiptRow label="Address" value={spot?.address_text ?? "Address on file"} />
                <ReceiptRow
                    label="When"
                    value={`${formatDateTimeCompact(start)} -> ${formatDateTimeCompact(end)}`}
                />
                <ReceiptRow label="Rate" value={`${perUnitLabel} / ${unit}`} />
                <ReceiptRow label="Total" value={totalLabel} />
            </ReceiptCard>

            {pay === "money" ? (
                moneyBidBelowMinimum ? (
                    <div className="card formSection" style={{ padding: 16, marginTop: 12 }}>
                        <div className="h3">Secure card authorization</div>
                        <div className="tiny muted" style={{ marginTop: 4 }}>
                            Card payments in GBP must be at least {formatGbp(STRIPE_MIN_GBP_PAYMENT)}.
                            This bid totals {formatGbp(totalMoney)}, so Stripe cannot create the authorization for this slot.
                            Increase the bid or use points instead.
                        </div>
                    </div>
                ) : (
                    <BidPaymentSection
                        amountGbp={totalMoney}
                        spotId={spotId}
                        start={start}
                        end={end}
                        token={token}
                        onBack={`/spots/${spotId}`}
                        onDone={handleMoneyBidDone}
                        onError={handleMoneyBidError}
                    />
                )
            ) : (
                <div className="card formSection" style={{ marginTop: 12 }}>
                    <div className="h3">Confirm points bid</div>
                    <div className="tiny muted" style={{ marginTop: 6 }}>
                        Points are reserved when your bid is accepted by the owner.
                    </div>
                    <div className="actionInlineGrid" style={{ marginTop: 10 }}>
                        <button className="btn btn-primary" onClick={confirmPoints} disabled={busy}>
                            {busy ? "Submitting..." : "Confirm bid"}
                        </button>
                        <Link to={`/spots/${spotId}`} className="btn">Cancel</Link>
                    </div>
                </div>
            )}
        </div>
    );
}
