import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, CardElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { apiGet, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string);

function calcUnitsForMinutes(minutes: number) {
    if (!Number.isFinite(minutes) || minutes <= 0) return 0;
    const roundedMinutes = Math.max(5, Math.ceil(minutes / 5) * 5);
    return roundedMinutes / 60;
}

function formatDateTime(s?: string | null) {
    if (!s) return "—";
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${dd}:${mm}:${yyyy} ${hh}:${min}`;
}

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
                This reserves the amount. You’re only charged if the owner accepts your bid.
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
                {busy ? "Authorizing…" : "Confirm & authorize"}
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

    const minutes = useMemo(() => {
        const s = new Date(start);
        const e = new Date(end);
        if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 0;
        return Math.round((e.getTime() - s.getTime()) / 60000);
    }, [start, end]);
    const units = useMemo(() => calcUnitsForMinutes(minutes), [minutes]);

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

    const minPerHour = useMemo(() => {
        const v = Number(spot?.auction_start_price_gbp ?? 0);
        return Number.isFinite(v) ? v : 0;
    }, [spot?.auction_start_price_gbp]);
    const auctionEnded = useMemo(() => {
        const end = spot?.auction_end ? new Date(spot.auction_end).getTime() : null;
        if (!end || !Number.isFinite(end)) return false;
        return end <= Date.now();
    }, [spot?.auction_end]);

    if (!token) return <Navigate to="/login" replace />;
    if (!spotId || !start || !end) {
        return <Navigate to="/" replace />;
    }

    async function confirmPoints() {
        if (!token) return;
        if (!spotId) return;
        const pts = Number(pointsPerHour);
        if (!Number.isFinite(pts) || pts <= 0) {
            setErr("Enter a valid points amount per hour.");
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

    const totalLabel = pay === "points" ? `${totalPoints} pts` : `£${totalMoney.toFixed(2)}`;
    const perHourLabel = pay === "points" ? `${Number(pointsPerHour || 0)} pts` : `£${Number(perHour || 0).toFixed(2)}`;
    const perHourTooLow = pay === "money" && minPerHour > 0 && Number(perHour || 0) < minPerHour;

    return (
        <div className="container">
            <div className="pageHeader">
                <div className="heroKicker">CONFIRMATION</div>
                <div className="heroTitle">Confirm your bid</div>
                <div className="heroSub muted">
                    Review the details before you authorize.
                </div>
            </div>

            {err && <div className="card formSection" style={{ color: "crimson" }}>{err}</div>}

            <div className="card receiptCard">
                <div className="receiptHeader">
                    <div className="heroKicker">PARKINGBUDDIES</div>
                    <div className="h2">Bid receipt</div>
                    <div className="tiny muted">Pending owner approval</div>
                </div>
                <div className="receiptBody">
                    <div className="receiptRow">
                        <span className="tiny muted">Listing</span>
                        <span className="spotInfoValue">{spot?.title ?? "Auction listing"}</span>
                    </div>
                    <div className="receiptRow">
                        <span className="tiny muted">Address</span>
                        <span className="spotInfoValue">{spot?.address_text ?? "Address on file"}</span>
                    </div>
                    <div className="receiptRow">
                        <span className="tiny muted">When</span>
                        <span className="spotInfoValue">{formatDateTime(start)} → {formatDateTime(end)}</span>
                    </div>
                    <div className="receiptRow">
                        <span className="tiny muted">Rate</span>
                        <span className="spotInfoValue">{perHourLabel} / hour</span>
                    </div>
                    <div className="receiptRow">
                        <span className="tiny muted">Total</span>
                        <span className="spotInfoValue">{totalLabel}</span>
                    </div>
                </div>
                <div className="receiptActions">
                    <Link to={`/spots/${spotId}`} className="btn">Back to listing</Link>
                </div>
            </div>

            {pay === "money" ? (
                <Elements stripe={stripePromise} options={{}}>
                    {auctionEnded ? (
                        <div className="card formSection" style={{ marginTop: 12 }}>
                            <div className="h3">Auction ended</div>
                            <div className="tiny muted" style={{ marginTop: 6 }}>
                                This auction has ended. You can’t place a new bid.
                            </div>
                            <div className="rowInline" style={{ marginTop: 10 }}>
                                <Link to={`/spots/${spotId}`} className="btn btn-primary">Back to listing</Link>
                            </div>
                        </div>
                    ) : perHourTooLow ? (
                        <div className="card formSection" style={{ marginTop: 12 }}>
                            <div className="h3">Bid amount too low</div>
                            <div className="tiny muted" style={{ marginTop: 6 }}>
                                Minimum bid per hour is £{minPerHour.toFixed(2)}.
                            </div>
                            <div className="rowInline" style={{ marginTop: 10 }}>
                                <Link to={`/spots/${spotId}`} className="btn btn-primary">Back to listing</Link>
                            </div>
                        </div>
                    ) : (
                        <BidCardForm
                            amountGbp={totalMoney}
                            spotId={spotId}
                            start={start}
                            end={end}
                            token={token}
                            onDone={() => navigate("/dashboard?tab=myAuctionBids")}
                            onError={(m) => setErr(m)}
                        />
                    )}
                </Elements>
            ) : (
                <div className="card formSection" style={{ marginTop: 12 }}>
                    <div className="h3">Confirm points bid</div>
                    <div className="tiny muted" style={{ marginTop: 6 }}>
                        Points are reserved when your bid is accepted by the owner.
                    </div>
                    <div className="rowInline" style={{ marginTop: 10 }}>
                        <button
                            className="btn btn-primary"
                            onClick={confirmPoints}
                            disabled={busy || auctionEnded}
                        >
                            {busy ? "Submitting…" : "Confirm bid"}
                        </button>
                        <Link to={`/spots/${spotId}`} className="btn">Cancel</Link>
                    </div>
                    {auctionEnded && (
                        <div className="tiny muted" style={{ marginTop: 8 }}>
                            Auction has ended. You can’t place a new bid.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
