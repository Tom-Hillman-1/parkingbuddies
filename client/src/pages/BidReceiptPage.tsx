import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiGet, apiPost, readErrorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ReceiptCard, ReceiptDivider, ReceiptRow } from "../components/ReceiptCard";
import {
    calcAuctionPointsTotal,
    calcAuctionUnitsForRange,
    formatDateRangeLocal,
    formatDateTimeLocal,
    formatGbp,
    type PriceUnit,
} from "./pagesShared";

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
    can_cancel?: boolean;
    created_at: string;
    start_time?: string;
    end_time?: string;
    spot_title?: string;
    spot_address?: string;
    owner_contact_email?: string | null;
    owner_contact_phone?: string | null;
    owner_contact_info?: string | null;
};

function renderMutedReceiptCopy(text: string) {
    return <span className="tiny muted">{text}</span>;
}

export default function BidReceiptPage() {
    const { bidId } = useParams();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { token } = useAuth();
    const [bid, setBid] = useState<BidReceipt | null>(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [cancelBusy, setCancelBusy] = useState(false);

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

    const paymentLabel = bid?.pay_method === "points" ? "Points bid" : "Card authorization";
    const paymentStatusLabel = useMemo(() => {
        if (!bid) return "-";
        if (bid.pay_method === "points") {
            const status = String(bid.status ?? "").toLowerCase();
            if (status === "accepted") return "Deducted on owner approval";
            if (status === "pending") return "Not deducted yet";
            if (status === "rejected") return "No points deducted";
            return "Pending owner decision";
        }
        const status = String(bid.status ?? "").toLowerCase();
        if (status === "accepted") return bid.payment_status ?? "Paid";
        if (status === "pending") return "Authorized only, not charged yet";
        if (status === "rejected") return "Authorization released";
        return bid.payment_status ?? "-";
    }, [bid]);

    const totalPoints = useMemo(() => {
        const units = calcAuctionUnitsForRange(bid?.start_time, bid?.end_time, bid?.price_unit ?? "hour");
        return calcAuctionPointsTotal(bid?.amount_points, units);
    }, [bid?.start_time, bid?.end_time, bid?.amount_points, bid?.price_unit]);

    const acceptedBid = String(bid?.status ?? "").toLowerCase() === "accepted";
    const windowText = formatDateRangeLocal(bid?.start_time, bid?.end_time);
    const placedAt = formatDateTimeLocal(bid?.created_at);
    const ownerContactEmail = String(bid?.owner_contact_email ?? "").trim();
    const ownerContactPhone = String(bid?.owner_contact_phone ?? "").trim();
    const ownerContactInfo = String(bid?.owner_contact_info ?? "").trim();
    const ownerContactPendingCopy = "Details will be shown once the bid is accepted.";

    function getOwnerContactValue(value: string) {
        if (!acceptedBid) {
            return renderMutedReceiptCopy(ownerContactPendingCopy);
        }
        if (value) return value;
        return renderMutedReceiptCopy("Not provided.");
    }

    const summaryTitle = acceptedBid ? "Booking summary" : "Bid summary";
    const summarySubtitle = acceptedBid
        ? "Your accepted bid has been turned into a booking."
        : `Bid confirmation #${id}`;
    const showConfirmationNotice = !!bid && String(bid.status ?? "").toLowerCase() !== "rejected";
    const confirmationTitle = acceptedBid ? "Booking confirmed" : "Bid submitted";
    const confirmationCopy = acceptedBid
        ? "Your accepted bid has been turned into a booking. The full details are below."
        : "The bid has been submitted. It is now waiting for the owner's decision.";

    async function cancelBid() {
        if (!token || !bid?.can_cancel || cancelBusy) return;
        setCancelBusy(true);
        setErr(null);
        try {
            await apiPost<{ cancelled_bid_id: string; authorization_release_pending?: boolean }>(
                `/auctions/bids/${bid.id}/cancel`,
                {},
                token
            );
            await queryClient.invalidateQueries({ queryKey: ["notification-summary"] });
            navigate("/dashboard?tab=myAuctionBids", { replace: true });
        } catch (error: unknown) {
            setErr(readErrorMessage(error, "Unable to cancel bid right now."));
        } finally {
            setCancelBusy(false);
        }
    }

    return (
        <div className="container">
            {showConfirmationNotice ? (
                <div className="paymentSuccessNotice">
                    <div className="h3">{confirmationTitle}</div>
                    <div className="createFieldHint">{confirmationCopy}</div>
                </div>
            ) : null}

            {err && <div className="card formSection">{err}</div>}

            {!loading && !err && bid && (
                <>
                    <ReceiptCard
                        kicker="PARKINGBUDDIES"
                        title={summaryTitle}
                        subtitle={summarySubtitle}
                    >
                        <ReceiptRow label="Booking" value={bid.spot_title ?? "Auction listing"} />
                        <ReceiptRow label="Location" value={bid.spot_address ?? "Address on file"} />
                        <ReceiptRow label="Window" value={windowText} />
                        {bid.pay_method === "points" ? (
                            <>
                                <ReceiptRow label="Bid rate" value={`${Number(bid.amount_points ?? 0)} pts / ${bid.price_unit ?? "hour"}`} />
                                <ReceiptRow label="Total amount" value={`${totalPoints} pts`} />
                            </>
                        ) : (
                            <ReceiptRow label="Amount" value={formatGbp(bid.amount_gbp)} />
                        )}
                        <ReceiptRow label="Status" value={statusLabel} />
                        <ReceiptRow label="Payment" value={paymentLabel} />
                        <ReceiptRow label="Payment status" value={paymentStatusLabel} />
                        <ReceiptRow label="Booked at" value={placedAt} />
                        <ReceiptDivider />
                        <ReceiptRow label="Owner email" value={getOwnerContactValue(ownerContactEmail)} />
                        <ReceiptRow label="Owner phone" value={getOwnerContactValue(ownerContactPhone)} />
                        <ReceiptRow label="Arrival notes" value={getOwnerContactValue(ownerContactInfo)} />
                    </ReceiptCard>

                    <div className="card formSection" style={{ marginTop: 14 }}>
                        <div className="h3">Next steps</div>
                        <div className="muted" style={{ marginTop: 6 }}>
                            {bid.status === "pending"
                                ? bid.pay_method === "points"
                                    ? "This points bid is pending approval. No points leave your balance unless the owner accepts it."
                                    : "The card is only authorized at this stage. You are charged only if the owner accepts the bid."
                                : bid.status === "accepted"
                                    ? "This bid was accepted and the booking is confirmed."
                                    : "This bid was rejected by the owner."}
                        </div>
                        <div className="actionInlineGrid" style={{ marginTop: 10 }}>
                            <Link to="/dashboard?tab=myAuctionBids" className="btn btn-primary">Manage bid</Link>
                            {bid.can_cancel && (
                                <button type="button" className="btn" onClick={() => void cancelBid()} disabled={cancelBusy}>
                                    {cancelBusy ? "Cancelling..." : "Cancel bid"}
                                </button>
                            )}
                            {bid.parking_spot_id && <Link to={`/spots/${bid.parking_spot_id}`} className="btn">View listing</Link>}
                        </div>
                        {bid.booking_id && (
                            <div className="actionInlineGrid" style={{ marginTop: 10 }}>
                                <Link to={`/pay/${bid.booking_id}`} className="btn">Booking confirmation</Link>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
