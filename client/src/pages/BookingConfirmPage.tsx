import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { apiGet, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";

type SpotLite = {
    id: string;
    title: string;
    address_text: string;
    mode: "free" | "rent" | "auction";
    price_gbp: number;
    price_unit?: "hour" | "day" | "week";
    allow_points?: boolean;
    points_cost?: number;
};

function fmtDateTime(iso: string) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
}

function calcUnits(minutes: number, unit: "hour" | "day" | "week") {
    if (!Number.isFinite(minutes) || minutes <= 0) return 0;
    if (unit === "hour") {
        const roundedMinutes = Math.max(5, Math.ceil(minutes / 5) * 5);
        return roundedMinutes / 60;
    }
    if (unit === "day") return Math.max(1, Math.ceil(minutes / (60 * 24)));
    return Math.max(1, Math.ceil(minutes / (60 * 24 * 7)));
}

function toMoney(x: any) {
    const n = Number(x ?? 0);
    return Number.isFinite(n) ? n : 0;
}

export default function BookingConfirmPage() {
    const { token } = useAuth();
    const navigate = useNavigate();
    const [search] = useSearchParams();

    const spotId = search.get("spotId") ?? "";
    const start = search.get("start") ?? "";
    const end = search.get("end") ?? "";
    const pay = (search.get("pay") === "points" ? "points" : "money") as "money" | "points";
    const pointsRaw = search.get("points") ?? "";

    const [spot, setSpot] = useState<SpotLite | null>(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!spotId) {
            setLoading(false);
            return;
        }
        setLoading(true);
        setErr(null);
        apiGet<{ parking_spot: SpotLite }>(`/parking-spots/${spotId}`)
            .then((r) => setSpot(r.parking_spot ?? null))
            .catch((e) => setErr(e.message || "Failed to load booking details"))
            .finally(() => setLoading(false));
    }, [spotId]);

    const startMs = useMemo(() => new Date(start).getTime(), [start]);
    const endMs = useMemo(() => new Date(end).getTime(), [end]);
    const validRange = Number.isFinite(startMs) && Number.isFinite(endMs) && startMs < endMs;
    const durationMinutes = validRange ? Math.round((endMs - startMs) / 60000) : 0;
    const unit = (spot?.price_unit ?? "hour") as "hour" | "day" | "week";
    const units = calcUnits(durationMinutes, unit);
    const minPoints = Math.ceil(Number(spot?.points_cost ?? 0) * units);
    const requestedPoints = Math.ceil(Number(pointsRaw || 0));
    const estimatedMoney = Math.max(0, toMoney(spot?.price_gbp) * units);

    if (!token) return <Navigate to="/login" replace />;
    if (!spotId || !start || !end) return <Navigate to="/" replace />;

    async function confirmBooking() {
        if (!token) return;
        if (!spot) {
            setErr("Listing details are not ready. Please try again.");
            return;
        }
        if (!validRange) {
            setErr("Invalid booking time range.");
            return;
        }
        if (pay === "points") {
            if (!spot.allow_points || Number(spot.points_cost ?? 0) <= 0) {
                setErr("This listing cannot be booked with points.");
                return;
            }
            if (!Number.isFinite(requestedPoints) || requestedPoints <= 0) {
                setErr("Enter a valid points amount.");
                return;
            }
            if (minPoints > 0 && requestedPoints < minPoints) {
                setErr(`Minimum for this slot is ${minPoints} pts.`);
                return;
            }
        }

        setBusy(true);
        setErr(null);
        try {
            const body: any = {
                parking_spot_id: spotId,
                start_time: start,
                end_time: end,
                pay_method: pay,
            };
            if (pay === "points") {
                body.points_amount = requestedPoints;
            }
            const r = await apiPost<{ booking: any }>("/bookings", body, token);
            const booking = r.booking;
            if (!booking?.id) {
                throw new Error("Booking created but missing booking id.");
            }
            const needsMoneyPayment =
                booking.pay_method === "money" &&
                Number(booking.total_price_gbp ?? 0) > 0 &&
                booking.status === "pending";
            if (needsMoneyPayment) {
                navigate(`/pay/${booking.id}`);
            } else {
                navigate("/dashboard?tab=myBookings");
            }
        } catch (e: any) {
            setErr(e?.message || "Booking failed");
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="container">
            <div className="pageHeader">
                <div className="heroKicker">CONFIRMATION</div>
                <div className="heroTitle">Confirm the details</div>
                <div className="heroSub muted">Review details before secure Stripe checkout.</div>
            </div>

            {loading && <div className="card formSection">Preparing confirmation…</div>}
            {err && <div className="card formSection" style={{ color: "crimson" }}>{err}</div>}

            {!loading && spot && (
                <div className="card receiptCard">
                    <div className="receiptHeader">
                        <div className="heroKicker">PARKINGBUDDIES</div>
                        <div className="h2">Booking confirmation</div>
                        <div className="tiny muted">Stripe checkout starts after you confirm.</div>
                    </div>
                    <div className="receiptBody">
                        <div className="receiptRow">
                            <span className="tiny muted">Listing</span>
                            <span className="spotInfoValue">{spot.title}</span>
                        </div>
                        <div className="receiptRow">
                            <span className="tiny muted">Address</span>
                            <span className="spotInfoValue">{spot.address_text}</span>
                        </div>
                        <div className="receiptRow">
                            <span className="tiny muted">When</span>
                            <span className="spotInfoValue">{fmtDateTime(start)} → {fmtDateTime(end)}</span>
                        </div>
                        <div className="receiptRow">
                            <span className="tiny muted">Payment type</span>
                            <span className="spotInfoValue">{pay === "points" ? "Points" : "Money"}</span>
                        </div>
                        {pay === "points" ? (
                            <>
                                <div className="receiptRow">
                                    <span className="tiny muted">Requested points</span>
                                    <span className="spotInfoValue">{requestedPoints} pts</span>
                                </div>
                                <div className="receiptRow">
                                    <span className="tiny muted">Minimum points</span>
                                    <span className="spotInfoValue">{minPoints} pts</span>
                                </div>
                            </>
                        ) : (
                            <div className="receiptRow">
                                <span className="tiny muted">Estimated total</span>
                                <span className="spotInfoValue">£{estimatedMoney.toFixed(2)}</span>
                            </div>
                        )}
                    </div>
                    <div className="receiptActions">
                        <button
                            type="button"
                            className="btn btn-primary"
                            onClick={confirmBooking}
                            disabled={busy}
                        >
                            {busy ? "Preparing..." : pay === "money" ? "Continue to Stripe checkout" : "Confirm booking"}
                        </button>
                        <Link to={`/spots/${spotId}`} className="btn">
                            Back to listing
                        </Link>
                    </div>
                </div>
            )}
        </div>
    );
}
