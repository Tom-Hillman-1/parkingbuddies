import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, CardElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { apiGet, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ReceiptCard, ReceiptRow } from "../components/ReceiptCard";
import { calcUnitsForMinutes, formatDateTimeCompact, type PriceUnit } from "./pagesShared";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string);
const POUND = String.fromCharCode(163);

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
    onDone,
    onError,
}: {
    amountGbp: number;
    spotId: string;
    start: string;
    end: string;
    token: string;
    onDone: () => void;
    onError: (msg: string) => void;
}) {
    const stripe = useStripe();
    const elements = useElements();
    const [busy, setBusy] = useState(false);

    async function confirm() {
        if (!stripe || !elements) return;
        setBusy(true);
        try {
            const intent = await apiPost<{ client_secret: string; payment_intent_id: string }>(
                "/payments/auction-intent",
                { spot_id: spotId, amount_gbp: amountGbp },
                token
            );
            const card = elements.getElement(CardElement);
            if (!card) {
                onError("Card input not ready");
                setBusy(false);
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

            await apiPost(
                `/auctions/${spotId}/bid`,
                {
                    amount_gbp: amountGbp,
                    payment_intent_id: intent.payment_intent_id,
                    start_time: start,
                    end_time: end,
                    pay_method: "money",
                },
                token
            );

            onDone();
        } catch (e: any) {
            onError(e?.message || "Authorization failed");
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
            <button
                onClick={confirm}
                disabled={!stripe || busy}
                className="btn btn-primary"
                style={{ marginTop: 12 }}
            >
                {busy ? "Authorizing..." : "Confirm & authorize"}
            </button>
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
    const perHour = useQueryValue("perHour");
    const pointsPerHour = useQueryValue("pointsPerHour");

    const [spot, setSpot] = useState<any | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const unit = (spot?.price_unit ?? "hour") as PriceUnit;

    const minutes = useMemo(() => {
        const s = new Date(start);
        const e = new Date(end);
        if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 0;
        return Math.round((e.getTime() - s.getTime()) / 60000);
    }, [start, end]);
    const units = useMemo(() => calcUnitsForMinutes(minutes, unit), [minutes, unit]);

    const totalMoney = useMemo(() => {
        const n = Number(perHour);
        if (!Number.isFinite(n) || n <= 0) return 0;
        if (!Number.isFinite(units) || units <= 0) return 0;
        return Math.round(n * units * 100) / 100;
    }, [perHour, units]);
    const totalPoints = useMemo(() => {
        const n = Number(pointsPerHour);
        if (!Number.isFinite(n) || n <= 0) return 0;
        if (!Number.isFinite(units) || units <= 0) return 0;
        return Math.ceil(n * units);
    }, [pointsPerHour, units]);

    useEffect(() => {
        if (!spotId) return;
        apiGet<{ parking_spot: any }>(`/parking-spots/${spotId}`)
            .then((r) => setSpot(r.parking_spot ?? null))
            .catch(() => setSpot(null));
    }, [spotId]);

    if (!token) return <Navigate to="/login" replace />;
    if (!spotId || !start || !end) {
        return <Navigate to="/" replace />;
    }

    async function confirmPoints() {
        if (!token || !spotId) return;
        const pts = Number(pointsPerHour);
        if (!Number.isFinite(pts) || pts <= 0) {
            setErr(`Enter a valid points amount per ${unit}.`);
            return;
        }
        setBusy(true);
        setErr(null);
        try {
            await apiPost(
                `/auctions/${spotId}/bid`,
                {
                    amount_points: pts,
                    start_time: start,
                    end_time: end,
                    pay_method: "points",
                },
                token
            );
            navigate("/dashboard?tab=myAuctionBids");
        } catch (e: any) {
            setErr(e?.message || "Bid failed");
        } finally {
            setBusy(false);
        }
    }

    const totalLabel = pay === "points" ? `${totalPoints} pts` : `${POUND}${totalMoney.toFixed(2)}`;
    const perUnitLabel =
        pay === "points" ? `${Number(pointsPerHour || 0)} pts` : `${POUND}${Number(perHour || 0).toFixed(2)}`;

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
                actions={<Link to={`/spots/${spotId}`} className="btn">Back to listing</Link>}
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
                        onDone={() => navigate("/dashboard?tab=myAuctionBids")}
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
