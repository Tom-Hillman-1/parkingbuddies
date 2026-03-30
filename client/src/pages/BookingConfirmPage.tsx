import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { ReceiptCard, ReceiptRow } from "../components/ReceiptCard";
import { apiGet, apiPost, readErrorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
    calcRangeMinutes,
    calcUnitsForMinutes,
    formatDateTimeCompact,
    type PriceUnit,
} from "./pagesShared";

type SpotSummary = {
    id: string;
    title: string;
    address_text: string;
    mode: "free" | "rent" | "auction";
    price_unit?: PriceUnit;
    allow_points?: boolean;
    points_cost?: number | string | null;
};

type BookingResult = {
    id: string;
};

function useQueryValue(key: string, fallback = "") {
    const [search] = useSearchParams();
    return search.get(key) ?? fallback;
}

export default function BookingConfirmPage() {
    const { token, user, refreshMe } = useAuth();
    const navigate = useNavigate();

    const spotId = useQueryValue("spotId");
    const start = useQueryValue("start");
    const end = useQueryValue("end");

    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const spotQuery = useQuery({
        queryKey: ["booking-confirm-spot", spotId],
        enabled: Boolean(spotId),
        queryFn: async () => {
            const response = await apiGet<{ parking_spot: SpotSummary }>(`/parking-spots/${spotId}`);
            return response.parking_spot ?? null;
        },
    });

    const spot = spotQuery.data ?? null;
    const listingPath = spotId ? `/spots/${spotId}` : "/";
    const unit = (spot?.price_unit ?? "hour") as PriceUnit;
    const units = useMemo(() => calcUnitsForMinutes(calcRangeMinutes(start, end), unit), [end, start, unit]);
    const pointsPerUnit = Number(spot?.points_cost ?? 0);
    const totalPoints = useMemo(() => {
        if (!Number.isFinite(pointsPerUnit) || pointsPerUnit <= 0) return 0;
        if (!Number.isFinite(units) || units <= 0) return 0;
        return Math.ceil(pointsPerUnit * units);
    }, [pointsPerUnit, units]);
    const userPoints = Number(user?.points_balance ?? 0);
    const pointsAfterTransaction = Math.max(0, userPoints - totalPoints);
    const insufficientPoints = totalPoints > 0 && userPoints < totalPoints;

    if (!token) return <Navigate to="/login" replace />;
    if (!spotId || !start || !end) return <Navigate to="/" replace />;

    async function confirmBooking() {
        if (!token || !spot) return;
        if (spot.mode === "auction") {
            setErr("Auction listings must be booked through bids.");
            return;
        }
        if (!spot.allow_points || totalPoints <= 0) {
            setErr("Points booking is not available for this listing.");
            return;
        }
        if (insufficientPoints) {
            setErr(`You need ${totalPoints} pts, you have ${userPoints}.`);
            return;
        }

        setBusy(true);
        setErr(null);
        try {
            const response = await apiPost<{ booking: BookingResult }>(
                "/bookings",
                {
                    parking_spot_id: spot.id,
                    start_time: start,
                    end_time: end,
                    pay_method: "points",
                    points_amount: totalPoints,
                },
                token
            );
            await refreshMe();
            navigate(`/pay/${response.booking.id}`);
        } catch (error: unknown) {
            setErr(readErrorMessage(error, "Booking failed."));
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="container">
            <div className="pageHeader">
                <div className="heroKicker">CONFIRMATION</div>
                <div className="heroTitle">Confirm your points booking</div>
                <div className="heroSub muted">Review the summary before points are deducted.</div>
            </div>

            {err && <div className="card formSection" style={{ color: "crimson" }}>{err}</div>}

            <ReceiptCard
                kicker="PARKINGBUDDIES"
                title="Booking summary"
                subtitle="Points are deducted once you confirm this booking."
                actions={<Link to={listingPath} className="btn">Back to listing</Link>}
            >
                <ReceiptRow label="Listing" value={spot?.title ?? "Parking space"} />
                <ReceiptRow label="Address" value={spot?.address_text ?? "Address on file"} />
                <ReceiptRow label="When" value={`${formatDateTimeCompact(start)} -> ${formatDateTimeCompact(end)}`} />
                <ReceiptRow label="Rate" value={`${Number.isFinite(pointsPerUnit) ? pointsPerUnit : 0} pts / ${unit}`} />
                <ReceiptRow label="Total" value={totalPoints > 0 ? `${totalPoints} pts` : "-"} />
                <ReceiptRow label="Your balance" value={`${userPoints} pts`} />
                <ReceiptRow label="Balance after payment" value={`${pointsAfterTransaction} pts`} />
            </ReceiptCard>

            <div className="card formSection" style={{ marginTop: 12 }}>
                <div className="h3">Confirm points payment</div>
                <div className="tiny muted" style={{ marginTop: 6 }}>
                    This booking is confirmed immediately once you continue, so this extra check prevents accidental payments.
                </div>
                {insufficientPoints && (
                    <div className="tiny" style={{ color: "#a23636", marginTop: 8 }}>
                        Not enough points. You need {totalPoints} pts and currently have {userPoints} pts.
                    </div>
                )}
                <div className="rowInline" style={{ marginTop: 12 }}>
                    <button className="btn btn-primary" onClick={confirmBooking} disabled={busy || insufficientPoints}>
                        {busy ? "Confirming..." : "Confirm booking"}
                    </button>
                    <Link to={listingPath} className="btn">Cancel</Link>
                </div>
            </div>
        </div>
    );
}
