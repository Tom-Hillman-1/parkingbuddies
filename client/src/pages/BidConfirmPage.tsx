import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, CardElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { apiGet, apiPost, readErrorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ReceiptCard, ReceiptRow } from "../components/ReceiptCard";
import {
    calcAuctionMoneyTotal,
    calcAuctionPointsTotal,
    calcAuctionUnitsForRange,
    formatDateTimeCompact,
    formatGbp,
    type PriceUnit,
} from "./pagesShared";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string);
type SpotSummary = { id: string; title: string; address_text: string; price_unit?: PriceUnit };

function useQueryValue(key: string, fallback = "") {
    const [search] = useSearchParams();
    return search.get(key) ?? fallback;
}

function BidCardForm({
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
    onError: (msg: string) => void;
}) {
    const stripe = useStripe();
    const elements = useElements();
    const [busy, setBusy] = useState(false);

    function buildIntentKey() {
        const normalizedStart = start.replace(/[^0-9A-Za-z]/g, "");
        const normalizedEnd = end.replace(/[^0-9A-Za-z]/g, "");
        const amount = Math.round(amountGbp * 100);
        return `bid_${spotId}_${normalizedStart}_${normalizedEnd}_${amount}_${Date.now()}`;
    }

    async function submitDemoAuthorization() {
        const response = await apiPost<{ bid_id: string }>(
            `/auctions/${spotId}/bid`,
            {
                amount_gbp: amountGbp,
                start_time: start,
                end_time: end,
                pay_method: "money",
                demo_authorization: true,
            },
            token
        );
        onDone(response.bid_id);
    }

    async function confirm() {
        if (!Number.isFinite(amountGbp) || amountGbp <= 0) {
            onError("Enter a valid money amount before authorizing.");
            return;
        }
        setBusy(true);
        onError("");
        let paymentIntentId: string | null = null;
        let bidSubmitted = false;
        try {
            if (!stripe || !elements) {
                await submitDemoAuthorization();
                bidSubmitted = true;
                return;
            }
            const intent = await apiPost<{ client_secret: string; payment_intent_id: string }>(
                "/payments/auction-intent",
                {
                    spot_id: spotId,
                    amount_gbp: amountGbp,
                    idempotency_key: buildIntentKey(),
                },
                token
            );
            paymentIntentId = intent.payment_intent_id;
            const card = elements.getElement(CardElement);
            if (!card) {
                await submitDemoAuthorization();
                bidSubmitted = true;
                return;
            }
            const result = await stripe.confirmCardPayment(intent.client_secret, {
                payment_method: { card },
            });
            if (result.error) {
                onError(result.error.message ?? "Card authorization failed");
                setBusy(false);
                return;
            }

            const response = await apiPost<{ bid_id: string }>(
                `/auctions/${spotId}/bid`,
                {
                    amount_gbp: amountGbp,
                    payment_intent_id: paymentIntentId,
                    start_time: start,
                    end_time: end,
                    pay_method: "money",
                },
                token
            );
            bidSubmitted = true;
            onDone(response.bid_id);
        } catch (error: unknown) {
            if (paymentIntentId && !bidSubmitted) {
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
            <div className="h3">Card authorization</div>
            <div className="tiny muted" style={{ marginTop: 4 }}>
                This reserves the amount. You're only charged if the owner accepts your bid.
            </div>
            <div style={{ padding: 10, border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, marginTop: 10 }}>
                <CardElement options={{ hidePostalCode: true }} />
            </div>
            <div className="rowInline" style={{ marginTop: 12 }}>
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

export default function BidConfirmPage() {
    const { token } = useAuth();
    const navigate = useNavigate();

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
                <Elements stripe={stripePromise} options={{}}>
                    <BidCardForm
                        amountGbp={totalMoney}
                        spotId={spotId}
                        start={start}
                        end={end}
                        token={token}
                        onBack={`/spots/${spotId}`}
                        onDone={(bidId) => navigate(`/bids/${bidId}`)}
                        onError={(m) => setErr(m)}
                    />
                </Elements>
            ) : (
                <div className="card formSection" style={{ marginTop: 12 }}>
                    <div className="h3">Confirm points bid</div>
                    <div className="tiny muted" style={{ marginTop: 6 }}>
                        Points are reserved when your bid is accepted by the owner.
                    </div>
                    <div className="rowInline" style={{ marginTop: 10 }}>
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
