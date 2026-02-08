import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiGet } from "../lib/api";
import { useAuth } from "../lib/auth";

type BidReceipt = {
    id: string;
    parking_spot_id: string;
    booking_id?: string | null;
    amount_gbp: any;
    amount_points?: number | null;
    pay_method?: "money" | "points";
    status: string;
    payment_status?: string | null;
    created_at: string;
    start_time?: string;
    end_time?: string;
    spot_title?: string;
    spot_address?: string;
};

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

function calcUnitsForMinutes(minutes: number) {
    if (!Number.isFinite(minutes) || minutes <= 0) return 0;
    const roundedMinutes = Math.max(5, Math.ceil(minutes / 5) * 5);
    return roundedMinutes / 60;
}

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
        if (!bid?.status) return "—";
        const s = String(bid.status).toLowerCase();
        if (s === "pending") return "Pending owner approval";
        if (s === "accepted") return "Accepted";
        if (s === "rejected") return "Rejected";
        return bid.status;
    }, [bid?.status]);

    const paymentLabel = bid?.pay_method === "points" ? "Points" : "Card";
    const paymentStatusLabel = useMemo(() => {
        if (!bid) return "—";
        if (bid.pay_method === "points") return "Applied on owner approval";
        const s = String(bid.status ?? "").toLowerCase();
        if (s === "accepted") return bid.payment_status ?? "Paid";
        if (s === "pending") return "Authorized (awaiting owner approval)";
        if (s === "rejected") return "Authorization released";
        return bid.payment_status ?? "—";
    }, [bid]);

    const totalPoints = useMemo(() => {
        if (!bid?.start_time || !bid?.end_time) return 0;
        const s = new Date(bid.start_time);
        const e = new Date(bid.end_time);
        if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 0;
        const minutes = Math.round((e.getTime() - s.getTime()) / 60000);
        const units = calcUnitsForMinutes(minutes);
        return Math.ceil(Number(bid.amount_points ?? 0) * units);
    }, [bid?.start_time, bid?.end_time, bid?.amount_points]);

    return (
        <div className="container">
            <div className="pageHeader">
                <div className="heroKicker">CONFIRMATION</div>
                <div className="heroTitle">Auction bid receipt</div>
                <div className="heroSub muted">
                    Review your bid details and payment method.
                </div>
            </div>

            {loading && <div className="card formSection">Preparing your receipt…</div>}
            {err && <div className="card formSection" style={{ color: "crimson" }}>{err}</div>}

            {!loading && !err && bid && (
                <>
                    <div className="card receiptCard">
                        <div className="receiptHeader">
                            <div className="heroKicker">PARKINGBUDDIES</div>
                            <div className="h2">Bid receipt</div>
                            <div className="tiny muted">Confirmation #{id}</div>
                        </div>
                        <div className="receiptBody">
                            <div className="receiptRow">
                                <span className="tiny muted">Status</span>
                                <span className="spotInfoValue">{statusLabel}</span>
                            </div>
                            <div className="receiptRow">
                                <span className="tiny muted">Payment</span>
                                <span className="spotInfoValue">{paymentLabel}</span>
                            </div>
                            <div className="receiptRow">
                                <span className="tiny muted">Payment status</span>
                                <span className="spotInfoValue">{paymentStatusLabel}</span>
                            </div>
                            <div className="receiptRow">
                                <span className="tiny muted">Spot</span>
                                <span className="spotInfoValue">{bid.spot_title ?? "—"}</span>
                            </div>
                            <div className="receiptRow">
                                <span className="tiny muted">Address</span>
                                <span className="spotInfoValue">{bid.spot_address ?? "—"}</span>
                            </div>
                            <div className="receiptRow">
                                <span className="tiny muted">When</span>
                                <span className="spotInfoValue">
                                    {bid.start_time && bid.end_time
                                        ? `${formatDateTime(bid.start_time)} → ${formatDateTime(bid.end_time)}`
                                        : "—"}
                                </span>
                            </div>
                            {bid.pay_method === "points" ? (
                                <>
                                    <div className="receiptRow">
                                        <span className="tiny muted">Bid rate</span>
                                        <span className="spotInfoValue">{Number(bid.amount_points ?? 0)} pts / hour</span>
                                    </div>
                                    <div className="receiptRow">
                                        <span className="tiny muted">Total (estimated)</span>
                                        <span className="spotInfoValue">{totalPoints} pts</span>
                                    </div>
                                </>
                            ) : (
                                <div className="receiptRow">
                                    <span className="tiny muted">Bid amount</span>
                                    <span className="spotInfoValue">
                                        £{Number(bid.amount_gbp ?? 0).toFixed(2)}
                                    </span>
                                </div>
                            )}
                            <div className="receiptRow">
                                <span className="tiny muted">Placed</span>
                                <span className="spotInfoValue">{formatDateTime(bid.created_at)}</span>
                            </div>
                        </div>
                    </div>

                    <div className="card formSection">
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
                            {bid.booking_id && (
                                <Link to={`/pay/${bid.booking_id}`} className="btn">Payment status</Link>
                            )}
                            {bid.parking_spot_id && (
                                <Link to={`/spots/${bid.parking_spot_id}`} className="btn">View listing</Link>
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
