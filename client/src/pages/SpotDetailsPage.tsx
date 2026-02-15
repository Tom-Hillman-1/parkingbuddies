import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import SpotsMap from "../components/SpotsMap";
import { apiGet, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";

type PriceUnit = "hour" | "day" | "week";
type PayMethod = "money" | "points";

type AvailabilityJson = {
    type: "24_7" | "same_everyday" | "custom_weekly";
    start?: string;
    end?: string;
    rules?: Array<{ dow: number; start: string; end: string }>;
    date_from?: string;
    date_to?: string;
};

type ParkingSpot = {
    id: string;
    owner_user_id: string;
    title: string;
    description: string;
    address_text: string;
    lat: number;
    lng: number;
    image_url?: string | null;
    mode: "free" | "rent" | "auction";
    price_gbp: number | string;
    price_unit?: PriceUnit;
    allow_points?: boolean;
    points_cost?: number;
    auction_end?: string | null;
    auction_start_price_gbp?: number | null;
    availability_json?: AvailabilityJson | null;
    availability_type?: "24_7" | "weekly";
    available_days?: number[];
    daily_start?: string | null;
    daily_end?: string | null;
    capacity_total?: number;
};

type SpotBooking = {
    id: string;
    start_time?: string;
    end_time?: string;
    status?: string;
    pay_method?: PayMethod;
    total_price_gbp?: number | string;
};

type AuctionBid = {
    id: string;
    amount_gbp?: number;
    amount_points?: number;
    pay_method?: PayMethod;
    status: string;
    start_time?: string;
    end_time?: string;
    bidder_name?: string;
    bidder_email?: string;
};

type AuctionInfo = {
    highest_pending_bid_gbp: number;
    highest_pending_bid_points?: number;
    pending_bids?: AuctionBid[];
    sold_out?: boolean;
};

const QUICK_DURATION_HOURS = [1, 2, 4, 8, 12, 24, 48, 72, 168];

export default function SpotDetailsPage() {
    const { id } = useParams<{ id: string }>();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { token, user } = useAuth();

    const [spot, setSpot] = useState<ParkingSpot | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [bookings, setBookings] = useState<SpotBooking[]>([]);
    const [auctionInfo, setAuctionInfo] = useState<AuctionInfo | null>(null);

    const [selectedDate, setSelectedDate] = useState(localDateStr(new Date()));
    const [durationHours, setDurationHours] = useState(1);

    const [durationDialogOpen, setDurationDialogOpen] = useState(false);
    const [durationDialogDate, setDurationDialogDate] = useState(localDateStr(new Date()));
    const [durationDraftHours, setDurationDraftHours] = useState(1);

    const [payMethod, setPayMethod] = useState<PayMethod>("money");
    const [pointsAmount, setPointsAmount] = useState("");

    const [bidPayMethod, setBidPayMethod] = useState<PayMethod>("money");
    const [bidMoneyPerHour, setBidMoneyPerHour] = useState("");
    const [bidPointsPerHour, setBidPointsPerHour] = useState("");

    const [actionMsg, setActionMsg] = useState<string | null>(null);
    const [bidMsg, setBidMsg] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [bidBusy, setBidBusy] = useState(false);

    const refreshBookings = useCallback(async (spotId: string) => {
        try {
            const r = await apiGet<{ bookings: SpotBooking[] }>(`/bookings/spot/${spotId}`);
            setBookings(r.bookings ?? []);
        } catch {
            setBookings([]);
        }
    }, []);

    const refreshAuction = useCallback(async () => {
        if (!spot || spot.mode !== "auction") {
            setAuctionInfo(null);
            return;
        }

        try {
            const summary = token
                ? await apiGet<{ auction: AuctionInfo }>(`/auctions/${spot.id}`, token)
                : await apiGet<{ auction: AuctionInfo }>(`/auctions/${spot.id}`);
            setAuctionInfo(summary.auction ?? null);
        } catch {
            setAuctionInfo(null);
        }
    }, [spot, token]);

    useEffect(() => {
        if (!id) return;

        let active = true;
        setLoading(true);
        setError(null);

        apiGet<{ parking_spot: ParkingSpot }>(`/parking-spots/${id}`)
            .then((r) => {
                if (!active) return;
                setSpot(r.parking_spot ?? null);
            })
            .catch((e: any) => {
                if (!active) return;
                setError(e?.message || "Failed to load listing.");
            })
            .finally(() => {
                if (active) setLoading(false);
            });

        void refreshBookings(id);

        return () => {
            active = false;
        };
    }, [id, refreshBookings]);

    useEffect(() => {
        if (!spot || spot.mode !== "auction") return;
        void refreshAuction();
        const timer = window.setInterval(() => {
            void refreshAuction();
        }, 10000);
        return () => window.clearInterval(timer);
    }, [spot, refreshAuction]);

    useEffect(() => {
        const date = searchParams.get("date");
        const duration = searchParams.get("duration");

        if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
            setSelectedDate(date);
        }
        if (duration) {
            const parsed = parseDurationHours(duration);
            if (parsed > 0) setDurationHours(parsed);
        }
    }, [searchParams]);

    const startAt = useMemo(() => getAutoStartForDate(spot, selectedDate), [spot, selectedDate]);
    const durationMinutes = useMemo(() => toDurationMinutes(durationHours), [durationHours]);
    const endAt = useMemo(() => addMinutes(startAt, durationMinutes), [startAt, durationMinutes]);

    const canUsePoints = !!spot?.allow_points && toNumber(spot.points_cost) > 0;

    useEffect(() => {
        if (!canUsePoints && payMethod === "points") setPayMethod("money");
    }, [canUsePoints, payMethod]);

    useEffect(() => {
        if (!canUsePoints && bidPayMethod === "points") setBidPayMethod("money");
    }, [canUsePoints, bidPayMethod]);

    const slotRangeValid = useMemo(() => {
        if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) return false;
        return startAt < endAt;
    }, [startAt, endAt]);

    const slotAllowed = useMemo(() => {
        if (!spot || !slotRangeValid) return false;
        return isSlotAllowed(spot, startAt, endAt);
    }, [spot, startAt, endAt, slotRangeValid]);

    const overlappingBookings = useMemo(() => {
        if (!slotRangeValid) return [] as SpotBooking[];

        return bookings.filter((b) => {
            if (!b.start_time || !b.end_time) return false;
            const bs = new Date(b.start_time);
            const be = new Date(b.end_time);
            if (Number.isNaN(bs.getTime()) || Number.isNaN(be.getTime())) return false;
            return bs < endAt && be > startAt;
        });
    }, [bookings, startAt, endAt, slotRangeValid]);

    const capacity = Math.max(1, toNumber(spot?.capacity_total || 1));
    const spotsLeft = Math.max(0, capacity - overlappingBookings.length);
    const slotFull = spotsLeft <= 0;

    const slotStatus = useMemo(() => {
        if (!slotRangeValid) return { ok: false, label: "Pick a valid slot." };
        if (!slotAllowed) return { ok: false, label: "Requested slot is outside listing availability." };
        if (slotFull) {
            return {
                ok: false,
                label: capacity > 1 ? "All spaces are booked for this slot." : "This slot is currently booked.",
            };
        }
        return {
            ok: true,
            label: capacity > 1 ? `${spotsLeft} spot${spotsLeft === 1 ? "" : "s"} left for this slot.` : "Slot is available.",
        };
    }, [slotRangeValid, slotAllowed, slotFull, capacity, spotsLeft]);

    const isOwner = !!user && !!spot && user.id === spot.owner_user_id;

    const listingPrice = toNumber(spot?.price_gbp);
    const listingUnit = (spot?.price_unit ?? "hour") as PriceUnit;
    const estimatedTotal = useMemo(() => {
        if (!spot || spot.mode === "free") return 0;
        const units = calcUnitsForMinutes(durationMinutes, listingUnit);
        return roundMoney(listingPrice * units);
    }, [spot, durationMinutes, listingUnit, listingPrice]);

    const pointsMinTotal = useMemo(() => {
        if (!canUsePoints || !spot) return 0;
        const units = calcUnitsForMinutes(durationMinutes, listingUnit);
        return Math.ceil(toNumber(spot.points_cost) * units);
    }, [canUsePoints, spot, durationMinutes, listingUnit]);

    useEffect(() => {
        if (payMethod !== "points" || pointsMinTotal <= 0) return;
        const value = Number(pointsAmount);
        if (!Number.isFinite(value) || value < pointsMinTotal) setPointsAmount(String(pointsMinTotal));
    }, [payMethod, pointsMinTotal, pointsAmount]);

    const auctionMinPerHour = toNumber(spot?.auction_start_price_gbp);
    const bidUnits = useMemo(() => calcUnitsForMinutes(durationMinutes, "hour"), [durationMinutes]);
    const bidTotalMoney = useMemo(() => {
        const perHour = Number(bidMoneyPerHour);
        if (!Number.isFinite(perHour) || perHour <= 0) return 0;
        return roundMoney(perHour * bidUnits);
    }, [bidMoneyPerHour, bidUnits]);

    const bidTotalPoints = useMemo(() => {
        const perHour = Number(bidPointsPerHour);
        if (!Number.isFinite(perHour) || perHour <= 0) return 0;
        return Math.ceil(perHour * bidUnits);
    }, [bidPointsPerHour, bidUnits]);

    useEffect(() => {
        if (bidPayMethod !== "points") return;
        const min = toNumber(spot?.points_cost);
        if (min <= 0) return;
        const value = Number(bidPointsPerHour);
        if (!Number.isFinite(value) || value < min) setBidPointsPerHour(String(min));
    }, [bidPayMethod, bidPointsPerHour, spot?.points_cost]);

    const userPoints = toNumber(user?.points_balance);
    const bidPointsInsufficient = bidPayMethod === "points" && bidTotalPoints > 0 && userPoints < bidTotalPoints;

    const auctionSoldOut = !!auctionInfo?.sold_out;
    const auctionEnded = !!spot?.auction_end && new Date(spot.auction_end).getTime() <= Date.now();
    const auctionClosed = !!spot && spot.mode === "auction" && (auctionSoldOut || auctionEnded);

    function openDurationDialog(date: string) {
        setDurationDialogDate(date);
        setDurationDraftHours(durationHours);
        setDurationDialogOpen(true);
    }

    function applyDurationDialog() {
        setSelectedDate(durationDialogDate);
        setDurationHours(clampDuration(durationDraftHours));
        setDurationDialogOpen(false);
    }

    async function createBooking() {
        if (!token) return setActionMsg("Please log in to book this listing.");
        if (!spot || spot.mode === "auction") return;
        if (isOwner) return setActionMsg("You cannot book your own listing.");
        if (!slotStatus.ok) return setActionMsg(slotStatus.label);

        if (payMethod === "points") {
            const value = Number(pointsAmount);
            if (!Number.isFinite(value) || value <= 0) return setActionMsg("Enter a valid points amount.");
            if (pointsMinTotal > 0 && value < pointsMinTotal) return setActionMsg(`Minimum is ${pointsMinTotal} pts.`);
        }

        setBusy(true);
        setActionMsg(null);

        try {
            const body: Record<string, unknown> = {
                parking_spot_id: spot.id,
                start_time: startAt.toISOString(),
                end_time: endAt.toISOString(),
                pay_method: payMethod,
            };

            if (payMethod === "points") body.points_amount = Math.ceil(Number(pointsAmount || 0));

            const r = await apiPost<{ booking: SpotBooking }>("/bookings", body, token);
            const booking = r.booking;
            await refreshBookings(spot.id);

            const needsPayment =
                booking?.pay_method === "money" &&
                toNumber(booking?.total_price_gbp) > 0 &&
                booking?.status === "pending" &&
                booking?.id;

            if (needsPayment) return navigate(`/pay/${booking.id}`);
            navigate("/dashboard?tab=myBookings");
        } catch (e: any) {
            setActionMsg(e?.message || "Booking failed.");
        } finally {
            setBusy(false);
        }
    }

    function goToBidConfirm() {
        if (!spot || spot.mode !== "auction") return;
        if (!token) return setBidMsg("Please log in to place a bid.");
        if (isOwner) return setBidMsg("Owners cannot bid on their own listing.");
        if (auctionClosed) return setBidMsg(auctionSoldOut ? "Auction sold out." : "Auction has ended.");
        if (!slotStatus.ok) return setBidMsg(slotStatus.label);

        if (bidPayMethod === "money") {
            const value = Number(bidMoneyPerHour);
            if (!Number.isFinite(value) || value <= 0) return setBidMsg("Enter a valid GBP amount per hour.");
            if (auctionMinPerHour > 0 && value < auctionMinPerHour) {
                return setBidMsg(`Minimum bid per hour is GBP ${auctionMinPerHour.toFixed(2)}.`);
            }
        } else {
            const value = Number(bidPointsPerHour);
            const min = toNumber(spot.points_cost);
            if (!Number.isFinite(value) || value <= 0) return setBidMsg("Enter a valid points amount per hour.");
            if (min > 0 && value < min) return setBidMsg(`Minimum is ${min} pts per hour.`);
            if (bidPointsInsufficient) return setBidMsg(`You need ${bidTotalPoints} pts, you have ${userPoints}.`);
        }

        const params = new URLSearchParams({
            spotId: spot.id,
            start: startAt.toISOString(),
            end: endAt.toISOString(),
            pay: bidPayMethod,
            perHour: bidPayMethod === "money" ? bidMoneyPerHour : "",
            pointsPerHour: bidPayMethod === "points" ? bidPointsPerHour : "",
        });

        navigate(`/bids/confirm?${params.toString()}`);
    }

    async function acceptBid(bidId: string) {
        if (!token || !spot) return;
        setBidBusy(true);
        try {
            await apiPost(`/auctions/${spot.id}/accept`, { bid_id: bidId }, token);
            await refreshAuction();
            await refreshBookings(spot.id);
            setBidMsg("Bid accepted.");
        } catch (e: any) {
            setBidMsg(e?.message || "Failed to accept bid.");
        } finally {
            setBidBusy(false);
        }
    }

    if (loading) return <div style={{ padding: 24 }}>Loading listing...</div>;
    if (error) return <div style={{ padding: 24, color: "crimson" }}>{error}</div>;
    if (!spot) return <div style={{ padding: 24 }}>Listing not found.</div>;

    const modeLabel = capitalize(spot.mode);
    const priceLabel =
        spot.mode === "free"
            ? "Free"
            : spot.mode === "auction"
                ? `Bid from GBP ${auctionMinPerHour.toFixed(2)} / hour`
                : `GBP ${listingPrice.toFixed(2)} / ${listingUnit}`;

    const topBidMoney = toNumber(auctionInfo?.highest_pending_bid_gbp);
    const topBidPoints = toNumber(auctionInfo?.highest_pending_bid_points);
    const pendingBids = auctionInfo?.pending_bids ?? [];

    return (
        <div className="container">
            <div className="spotSimple">
                <aside className="spotSimpleSide">
                    <div className="card spotSimpleMedia">
                        <div className="h3">Map</div>
                        <div className="spotMapWrap" style={{ marginTop: 10 }}>
                            <SpotsMap spots={[spot as any]} center={{ lat: spot.lat, lng: spot.lng }} selectedId={spot.id} />
                        </div>
                    </div>

                    <div className="card spotSimpleMedia">
                        {spot.image_url ? (
                            <img src={spot.image_url} alt={spot.title} className="spotHeroImg" />
                        ) : (
                            <div className="spotHeroFallback">No image uploaded</div>
                        )}
                    </div>
                </aside>

                <main className="spotSimpleMain">
                    <div className={`card spotSimpleHeader ${auctionClosed ? "spotSimpleHeader--closed" : ""}`}>
                        <div className="heroKicker">ParkingBuddies</div>
                        <div className="heroTitle">{spot.title}</div>
                        <p className="muted" style={{ marginTop: 6 }}>{spot.description}</p>

                        <div className="spotSimpleBadges">
                            <span className="badge">{modeLabel}</span>
                            <span className="badge badge--cool">{priceLabel}</span>
                            <span className="badge">{formatAvailability(spot)}</span>
                            {capacity > 1 && (
                                <span className={`badge ${spotsLeft > 0 ? "badge--green" : "badge--rose"}`}>
                                    {spotsLeft}/{capacity} available
                                </span>
                            )}
                            {spot.mode === "auction" && topBidMoney > 0 && (
                                <span className="badge">Top bid GBP {topBidMoney.toFixed(2)}</span>
                            )}
                            {spot.mode === "auction" && topBidPoints > 0 && (
                                <span className="badge">Top bid {topBidPoints} pts</span>
                            )}
                            {auctionClosed && (
                                <span className="badge badge--rose">{auctionSoldOut ? "Auction sold out" : "Auction ended"}</span>
                            )}
                        </div>
                    </div>

                    <div className="card spotSimpleAction">
                        <div className="h3">Choose your slot</div>
                        <p className="tiny muted">Tap a date, pick duration, and we mark the selected range on the calendar.</p>

                        <SlotCalendar
                            spot={spot}
                            selectedDate={selectedDate}
                            startAt={startAt}
                            endAt={endAt}
                            onPickDate={openDurationDialog}
                            disabled={busy || bidBusy}
                        />

                        <div className="spotSimpleInlineMeta">
                            <span className="tiny muted">Start</span>
                            <span className="badge">{formatDateTime(startAt.toISOString())}</span>
                        </div>
                        <div className="spotSimpleInlineMeta">
                            <span className="tiny muted">Ends</span>
                            <span className="badge">{formatDateTime(endAt.toISOString())}</span>
                        </div>

                        <div className={`slotStatus ${slotStatus.ok ? "slotStatus--ok" : "slotStatus--bad"}`}>
                            {slotStatus.label}
                        </div>
                    </div>

                    {spot.mode === "auction" ? (
                        <div className="card spotSimpleAction">
                            <div className="h3">Place a bid</div>

                            {!token && (
                                <div className="spotAlert">
                                    Please <Link to="/login">log in</Link> to bid.
                                </div>
                            )}
                            {isOwner && <div className="spotAlert">You are the owner of this listing.</div>}

                            <div className="payToggle">
                                <button
                                    type="button"
                                    className={`payToggleBtn ${bidPayMethod === "money" ? "active" : ""}`}
                                    onClick={() => setBidPayMethod("money")}
                                    disabled={auctionClosed || bidBusy}
                                >
                                    Money
                                </button>
                                {canUsePoints && (
                                    <button
                                        type="button"
                                        className={`payToggleBtn ${bidPayMethod === "points" ? "active" : ""}`}
                                        onClick={() => setBidPayMethod("points")}
                                        disabled={auctionClosed || bidBusy}
                                    >
                                        Points
                                    </button>
                                )}
                            </div>

                            {bidPayMethod === "money" ? (
                                <label>
                                    <span>Bid per hour (GBP)</span>
                                    <input
                                        className="input"
                                        type="number"
                                        min={Math.max(0, auctionMinPerHour)}
                                        step={0.5}
                                        value={bidMoneyPerHour}
                                        onChange={(e) => setBidMoneyPerHour(e.target.value)}
                                        placeholder={auctionMinPerHour > 0 ? `Minimum ${auctionMinPerHour.toFixed(2)}` : "e.g. 8"}
                                        disabled={auctionClosed || bidBusy}
                                    />
                                    <div className="tiny muted">Estimated total: {bidTotalMoney > 0 ? `GBP ${bidTotalMoney.toFixed(2)}` : "-"}</div>
                                </label>
                            ) : (
                                <label>
                                    <span>Bid per hour (points)</span>
                                    <input
                                        className="input"
                                        type="number"
                                        min={Math.max(1, toNumber(spot.points_cost))}
                                        step={1}
                                        value={bidPointsPerHour}
                                        onChange={(e) => setBidPointsPerHour(e.target.value)}
                                        placeholder={spot.points_cost ? `Minimum ${spot.points_cost} pts` : "Points per hour"}
                                        disabled={auctionClosed || bidBusy}
                                    />
                                    <div className="tiny muted">Estimated total: {bidTotalPoints > 0 ? `${bidTotalPoints} pts` : "-"}</div>
                                    {bidPointsInsufficient && (
                                        <div className="tiny" style={{ color: "#a23636", marginTop: 4 }}>
                                            Not enough points ({userPoints} available).
                                        </div>
                                    )}
                                </label>
                            )}

                            <div className="rowInline" style={{ marginTop: 4 }}>
                                <button
                                    onClick={goToBidConfirm}
                                    className="btn btn-primary"
                                    disabled={!token || isOwner || auctionClosed || bidBusy || !slotStatus.ok}
                                >
                                    Review bid
                                </button>
                                {bidMsg && <span className="tiny muted">{bidMsg}</span>}
                            </div>
                        </div>
                    ) : (
                        <div className="card spotSimpleAction">
                            <div className="h3">Book this space</div>

                            {!token && (
                                <div className="spotAlert">
                                    Please <Link to="/login">log in</Link> to book.
                                </div>
                            )}
                            {isOwner && <div className="spotAlert">You cannot book your own listing.</div>}

                            <div className="spotSimpleInlineMeta">
                                <span className="tiny muted">Estimated total</span>
                                <span className="badge">{spot.mode === "free" ? "Free" : `GBP ${estimatedTotal.toFixed(2)}`}</span>
                            </div>

                            <div className="payToggle">
                                <button
                                    type="button"
                                    className={`payToggleBtn ${payMethod === "money" ? "active" : ""}`}
                                    onClick={() => setPayMethod("money")}
                                    disabled={busy}
                                >
                                    Card
                                </button>
                                {canUsePoints && (
                                    <button
                                        type="button"
                                        className={`payToggleBtn ${payMethod === "points" ? "active" : ""}`}
                                        onClick={() => setPayMethod("points")}
                                        disabled={busy}
                                    >
                                        Points
                                    </button>
                                )}
                            </div>

                            {payMethod === "points" && canUsePoints && (
                                <label>
                                    <span>Points amount</span>
                                    <input
                                        className="input"
                                        type="number"
                                        min={Math.max(1, pointsMinTotal)}
                                        step={1}
                                        value={pointsAmount}
                                        onChange={(e) => setPointsAmount(e.target.value)}
                                        placeholder={`Minimum ${pointsMinTotal} pts`}
                                        disabled={busy}
                                    />
                                    <div className="tiny muted">Minimum {pointsMinTotal} pts for this slot.</div>
                                </label>
                            )}

                            <div className="rowInline" style={{ marginTop: 4 }}>
                                <button
                                    onClick={createBooking}
                                    className="btn btn-primary"
                                    disabled={!token || isOwner || busy || !slotStatus.ok}
                                >
                                    {busy ? "Booking..." : payMethod === "money" ? "Continue to payment" : "Confirm points booking"}
                                </button>
                                {actionMsg && <span className="tiny muted">{actionMsg}</span>}
                            </div>
                        </div>
                    )}

                    {spot.mode === "auction" && isOwner && pendingBids.length > 0 && (
                        <div className="card spotSimpleAction">
                            <div className="h3">Incoming bids</div>
                            <div className="spotSimpleBidList">
                                {pendingBids.map((bid) => (
                                    <div key={bid.id} className="spotSimpleBid">
                                        <div className="rowInline" style={{ justifyContent: "space-between", gap: 10 }}>
                                            <strong>{formatBidAmount(bid)}</strong>
                                            <button className="btn btn-primary" onClick={() => acceptBid(bid.id)} disabled={bidBusy}>
                                                {bidBusy ? "Working..." : "Accept"}
                                            </button>
                                        </div>
                                        <div className="tiny muted">{bid.bidder_name || bid.bidder_email || "Bidder"}</div>
                                        {bid.start_time && bid.end_time && (
                                            <div className="tiny muted">{formatDateTime(bid.start_time)} {" -> "} {formatDateTime(bid.end_time)}</div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </main>
            </div>

            <DurationDialog
                open={durationDialogOpen}
                dateLabel={durationDialogDate}
                hours={durationDraftHours}
                setHours={setDurationDraftHours}
                onApply={applyDurationDialog}
                onClose={() => setDurationDialogOpen(false)}
            />
        </div>
    );
}

type SlotCalendarProps = {
    spot: ParkingSpot;
    selectedDate: string;
    startAt: Date;
    endAt: Date;
    onPickDate: (date: string) => void;
    disabled?: boolean;
};

function SlotCalendar({ spot, selectedDate, startAt, endAt, onPickDate, disabled }: SlotCalendarProps) {
    const cells = useMemo(() => buildCalendarCells(new Date(), 30), []);

    return (
        <div className="slotCal">
            <div className="slotCalHead">
                {WEEKDAYS.map((day) => (
                    <span key={day}>{day}</span>
                ))}
            </div>

            <div className="slotCalGrid">
                {cells.map((day, idx) => {
                    if (!day) return <div key={`blank-${idx}`} className="slotCalBlank" />;

                    const key = localDateStr(day);
                    const available = isDaySelectable(spot, day);
                    const fillPercent = getDayFillPercent(day, startAt, endAt);
                    const inRange = fillPercent > 0;
                    const selected = selectedDate === key;

                    return (
                        <button
                            key={key}
                            type="button"
                            className={`slotCalDay ${selected ? "slotCalDay--selected" : ""} ${inRange ? "slotCalDay--range" : ""}`}
                            onClick={() => onPickDate(key)}
                            disabled={disabled || !available}
                        >
                            <span className="slotCalNum">{day.getDate()}</span>
                            {day.getDate() === 1 && <span className="slotCalMonth">{day.toLocaleDateString(undefined, { month: "short" })}</span>}
                            <span className={`slotCalDot ${available ? "slotCalDot--ok" : "slotCalDot--off"}`} />
                            {fillPercent > 0 && (
                                <span className="slotCalFillWrap">
                                    <span className="slotCalFill" style={{ width: `${Math.max(10, Math.min(100, fillPercent))}%` }} />
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

type DurationDialogProps = {
    open: boolean;
    dateLabel: string;
    hours: number;
    setHours: (hours: number) => void;
    onApply: () => void;
    onClose: () => void;
};

function DurationDialog({ open, dateLabel, hours, setHours, onApply, onClose }: DurationDialogProps) {
    if (!open) return null;

    return (
        <div className="slotDialogBackdrop" role="dialog" aria-modal="true">
            <div className="card slotDialog">
                <div className="h3">Pick duration</div>
                <div className="tiny muted">{dateLabel}</div>

                <div className="slotDialogChoices">
                    {QUICK_DURATION_HOURS.map((value) => (
                        <button
                            key={value}
                            type="button"
                            className={`slotChip ${Math.abs(hours - value) < 0.01 ? "slotChip--active" : ""}`}
                            onClick={() => setHours(value)}
                        >
                            {value >= 24 ? `${value / 24}d` : `${value}h`}
                        </button>
                    ))}
                </div>

                <label>
                    <span>Custom hours</span>
                    <input
                        className="input"
                        type="number"
                        min={0.25}
                        max={720}
                        step={0.25}
                        value={hours}
                        onChange={(e) => setHours(clampDuration(Number(e.target.value)))}
                    />
                </label>

                <div className="rowInline" style={{ justifyContent: "flex-end" }}>
                    <button type="button" className="btn" onClick={onClose}>Cancel</button>
                    <button type="button" className="btn btn-primary" onClick={onApply}>Apply</button>
                </div>
            </div>
        </div>
    );
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function buildCalendarCells(startDate: Date, totalDays: number) {
    const start = startOfDay(startDate);
    const cells: Array<Date | null> = [];

    for (let i = 0; i < start.getDay(); i += 1) {
        cells.push(null);
    }

    for (let i = 0; i < totalDays; i += 1) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        cells.push(d);
    }

    return cells;
}

function getDayFillPercent(day: Date, startAt: Date, endAt: Date) {
    const dayStart = startOfDay(day);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const overlapStart = Math.max(dayStart.getTime(), startAt.getTime());
    const overlapEnd = Math.min(dayEnd.getTime(), endAt.getTime());
    if (overlapEnd <= overlapStart) return 0;

    return ((overlapEnd - overlapStart) / (24 * 60 * 60 * 1000)) * 100;
}

function isDaySelectable(spot: ParkingSpot, day: Date) {
    const dayStart = startOfDay(day);
    if (dayStart < startOfDay(new Date())) return false;

    const a = spot.availability_json;
    const key = localDateStr(dayStart);
    if (a?.date_from && key < a.date_from) return false;
    if (a?.date_to && key > a.date_to) return false;

    const isTwentyFourSeven = a?.type === "24_7" || (!a && (spot.availability_type ?? "24_7") === "24_7");
    if (isTwentyFourSeven) return true;

    const rules = extractAvailabilityRules(spot);
    return rules.some((r) => r.dow === dayStart.getDay());
}

function getAutoStartForDate(spot: ParkingSpot | null, ymd: string) {
    const day = parseYmd(ymd);
    if (!day) return nextWholeHour();

    const base = startOfDay(day);
    if (!spot) {
        const fallback = new Date(base);
        if (isSameDay(fallback, new Date())) return nextWholeHour();
        return fallback;
    }

    const a = spot.availability_json;
    const isTwentyFourSeven = a?.type === "24_7" || (!a && (spot.availability_type ?? "24_7") === "24_7");

    let start = new Date(base);

    if (!isTwentyFourSeven) {
        const todaysRules = extractAvailabilityRules(spot)
            .filter((r) => r.dow === base.getDay())
            .sort((x, y) => hhmmToMinutes(x.start) - hhmmToMinutes(y.start));

        if (todaysRules.length > 0) {
            start = setTime(base, todaysRules[0].start);
        }
    }

    const now = nextWholeHour();
    if (isSameDay(start, now) && now > start) return now;
    return start;
}

function formatAvailability(spot: ParkingSpot) {
    const a = spot.availability_json;
    if (a?.type === "24_7") return "24/7";
    if (a?.type === "same_everyday" && a.start && a.end) return `Daily ${a.start}-${a.end}`;
    if (a?.type === "custom_weekly" && Array.isArray(a.rules)) {
        return a.rules.map((r) => `${dayShort(r.dow)} ${r.start}-${r.end}`).join(", ");
    }

    if (spot.availability_type === "24_7") return "24/7";
    if (spot.availability_type === "weekly" && Array.isArray(spot.available_days)) {
        const days = spot.available_days.map(dayShort).join(", ");
        const start = spot.daily_start?.slice(0, 5);
        const end = spot.daily_end?.slice(0, 5);
        return start && end ? `${days} ${start}-${end}` : `${days} (weekly)`;
    }

    return "Not specified";
}

function isSlotAllowed(spot: ParkingSpot, start: Date, end: Date) {
    if (!(start < end)) return false;

    const rules = extractAvailabilityRules(spot);
    if (!rules.length) return true;

    const a = spot.availability_json;
    const from = a?.date_from ? new Date(`${a.date_from}T00:00:00`) : null;
    const to = a?.date_to ? new Date(`${a.date_to}T23:59:59`) : null;

    if (from && start < from) return false;
    if (to && end > to) return false;

    const isTwentyFourSeven = a?.type === "24_7" || (!a && (spot.availability_type ?? "24_7") === "24_7");
    if (isTwentyFourSeven) return true;

    if (!isSameDay(start, end)) return false;

    const dayRules = rules.filter((r) => r.dow === start.getDay());
    if (!dayRules.length) return false;

    for (const rule of dayRules) {
        const ruleStart = setTime(start, rule.start);
        const ruleEnd = setTime(start, rule.end);
        if (start >= ruleStart && end <= ruleEnd) return true;
    }

    return false;
}

function extractAvailabilityRules(spot: ParkingSpot): Array<{ dow: number; start: string; end: string }> {
    const a = spot.availability_json;

    if (a?.type === "24_7") {
        return Array.from({ length: 7 }).map((_, dow) => ({ dow, start: "00:00", end: "23:59" }));
    }

    if (a?.type === "same_everyday" && a.start && a.end) {
        return Array.from({ length: 7 }).map((_, dow) => ({ dow, start: a.start!, end: a.end! }));
    }

    if (a?.type === "custom_weekly" && Array.isArray(a.rules)) {
        return a.rules.filter(
            (r): r is { dow: number; start: string; end: string } =>
                typeof r?.dow === "number" && typeof r?.start === "string" && typeof r?.end === "string"
        );
    }

    if (spot.availability_type === "24_7") {
        return Array.from({ length: 7 }).map((_, dow) => ({ dow, start: "00:00", end: "23:59" }));
    }

    if (spot.availability_type === "weekly" && Array.isArray(spot.available_days)) {
        const start = spot.daily_start?.slice(0, 5) ?? "00:00";
        const end = spot.daily_end?.slice(0, 5) ?? "23:59";
        return spot.available_days.map((dow) => ({ dow, start, end }));
    }

    return [];
}

function calcUnitsForMinutes(minutes: number, unit: PriceUnit) {
    if (!Number.isFinite(minutes) || minutes <= 0) return 0;

    if (unit === "hour") {
        const roundedMinutes = Math.max(5, Math.ceil(minutes / 5) * 5);
        return roundedMinutes / 60;
    }

    if (unit === "day") return Math.max(1, Math.ceil(minutes / (24 * 60)));
    return Math.max(1, Math.ceil(minutes / (24 * 60 * 7)));
}

function toDurationMinutes(hours: number) {
    return Math.max(15, Math.round((clampDuration(hours) * 60) / 15) * 15);
}

function parseDurationHours(raw: string) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 0;
    const hours = n > 24 ? n / 60 : n;
    return clampDuration(hours);
}

function clampDuration(value: number) {
    if (!Number.isFinite(value)) return 1;
    return Math.min(720, Math.max(0.25, Math.round(value * 4) / 4));
}

function formatBidAmount(bid: AuctionBid) {
    if (bid.pay_method === "points" || bid.amount_points != null) return `${toNumber(bid.amount_points)} pts`;
    return `GBP ${toNumber(bid.amount_gbp).toFixed(2)}`;
}

function capitalize(value: string) {
    if (!value) return value;
    return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatDateTime(iso: string) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return `${pad2(d.getDate())}:${pad2(d.getMonth() + 1)}:${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function nextWholeHour() {
    const now = new Date();
    const d = new Date(now);
    d.setMinutes(0, 0, 0);
    if (d <= now) d.setHours(d.getHours() + 1);
    return d;
}

function addMinutes(date: Date, minutes: number) {
    return new Date(date.getTime() + minutes * 60000);
}

function setTime(date: Date, hhmm: string) {
    const [h, m] = hhmm.split(":").map((v) => Number(v));
    const out = new Date(date);
    out.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
    return out;
}

function parseYmd(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const d = new Date(`${value}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
}

function localDateStr(date: Date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function pad2(n: number) {
    return String(n).padStart(2, "0");
}

function startOfDay(date: Date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

function isSameDay(a: Date, b: Date) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function hhmmToMinutes(hhmm: string) {
    const [h, m] = hhmm.split(":").map((v) => Number(v));
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function toNumber(value: unknown) {
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? n : 0;
}

function roundMoney(value: number) {
    return Math.round(value * 100) / 100;
}

function dayShort(dow: number) {
    return WEEKDAYS[dow] ?? "Day";
}
