import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiGet } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ReceiptCard, ReceiptRow } from "../components/ReceiptCard";
import { calcUnitsForMinutes, formatDateTimeCompact, type PriceUnit } from "./pagesShared";

type BidReceipt = {
    id: string;
    parking_spot_id: string;
    booking_id?: string | null;
    amount_gbp: number | string | null;
    amount_points?: number | null;
    pay_method?: "money" | "points";
    status: string;
    payment_status?: string | null;
    price_unit?: PriceUnit;
    created_at: string;
    start_time?: string;
    end_time?: string;
    spot_title?: string;
    spot_address?: string;
};

const POUND = String.fromCharCode(163);

export default function BidReceiptPage() {
    const { bidId } = useParams();
    const { token } = useAuth();
    const [bid, setBid] = useState<BidReceipt | null>(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);

    const id = bidId ?? "";

    useEffect(() => {
        if (!id) {
            setErr("Missing bidId in URL");
            setLoading(false);
            return;
        }
        if (!token) {
            setErr("You must be logged in to view this receipt");
            setLoading(false);
            return;
        }

        (async () => {
            try {
                setLoading(true);
                setErr(null);
                const r = await apiGet<{ bid: BidReceipt }>(`/auctions/bids/${id}`, token);
                setBid(r.bid ?? null);
            } catch (e) {
                setErr(e instanceof Error ? e.message : "Failed to load bid receipt");
            } finally {
                setLoading(false);
            }
        })();
    }, [id, token]);

    const statusLabel = useMemo(() => {
        if (!bid?.status) return "-";
        const status = String(bid.status).toLowerCase();
        if (status === "pending") return "Pending owner approval";
        if (status === "accepted") return "Accepted";
        if (status === "rejected") return "Rejected";
        return bid.status;
    }, [bid?.status]);

    const paymentLabel = bid?.pay_method === "points" ? "Points" : "Card";
    const paymentStatusLabel = useMemo(() => {
        if (!bid) return "-";
        if (bid.pay_method === "points") return "Applied on owner approval";
        const status = String(bid.status ?? "").toLowerCase();
        if (status === "accepted") return bid.payment_status ?? "Paid";
        if (status === "pending") return "Authorized (awaiting owner approval)";
        if (status === "rejected") return "Authorization released";
        return bid.payment_status ?? "-";
    }, [bid]);

    const totalPoints = useMemo(() => {
        if (!bid?.start_time || !bid?.end_time) return 0;
        const start = new Date(bid.start_time);
        const end = new Date(bid.end_time);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
        const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
        const units = calcUnitsForMinutes(minutes, bid.price_unit ?? "hour");
        return Math.ceil(Number(bid.amount_points ?? 0) * units);
    }, [bid?.start_time, bid?.end_time, bid?.amount_points, bid?.price_unit]);

    const windowText =
        bid?.start_time && bid?.end_time
            ? `${formatDateTimeCompact(bid.start_time)} -> ${formatDateTimeCompact(bid.end_time)}`
            : "-";

    return (
        <div className="container">
            <div className="pageHeader">
                <div className="heroKicker">CONFIRMATION</div>
                <div className="heroTitle">Auction bid receipt</div>
                <div className="heroSub muted">Review your bid details and payment method.</div>
            </div>

            {loading && <div className="card formSection">Preparing your receipt...</div>}
            {err && <div className="card formSection" style={{ color: "crimson" }}>{err}</div>}

            {!loading && !err && bid && (
                <>
                    <ReceiptCard
                        kicker="PARKINGBUDDIES"
                        title="Bid receipt"
                        subtitle={`Confirmation #${id}`}
                    >
                        <ReceiptRow label="Status" value={statusLabel} />
                        <ReceiptRow label="Payment" value={paymentLabel} />
                        <ReceiptRow label="Payment status" value={paymentStatusLabel} />
                        <ReceiptRow label="Spot" value={bid.spot_title ?? "-"} />
                        <ReceiptRow label="Address" value={bid.spot_address ?? "-"} />
                        <ReceiptRow label="When" value={windowText} />
                        {bid.pay_method === "points" ? (
                            <>
                                <ReceiptRow label="Bid rate" value={`${Number(bid.amount_points ?? 0)} pts / ${bid.price_unit ?? "hour"}`} />
                                <ReceiptRow label="Total (estimated)" value={`${totalPoints} pts`} />
                            </>
                        ) : (
                            <ReceiptRow label="Bid amount" value={`${POUND}${Number(bid.amount_gbp ?? 0).toFixed(2)}`} />
                        )}
                        <ReceiptRow label="Placed" value={formatDateTimeCompact(bid.created_at)} />
                    </ReceiptCard>

                    <div className="card formSection" style={{ marginTop: 14 }}>
                        <div className="h3">Next steps</div>
                        <div className="muted" style={{ marginTop: 6 }}>
                            {bid.status === "pending"
                                ? "Your bid is pending approval from the owner."
                                : bid.status === "accepted"
                                    ? "Your bid was accepted and the booking is confirmed."
                                    : "This bid was rejected by the owner."}
                        </div>
                        <div className="rowInline" style={{ marginTop: 10 }}>
                            <Link to="/dashboard?tab=myAuctionBids" className="btn btn-primary">Go to dashboard</Link>
                            {bid.booking_id && <Link to={`/pay/${bid.booking_id}`} className="btn">Booking confirmation</Link>}
                            {bid.parking_spot_id && <Link to={`/spots/${bid.parking_spot_id}`} className="btn">View listing</Link>}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
