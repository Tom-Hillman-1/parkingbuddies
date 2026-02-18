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
    pending_bids?: AuctionBid[];
    sold_out?: boolean;
};

const MAX_DURATION_MINUTES = 30 * 24 * 60;
const DURATION_OPTIONS = buildDurationOptions();

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
    const [selectedStartTime, setSelectedStartTime] = useState(() => toTimeInput(nextWholeQuarterHour()));
    const [durationMinutes, setDurationMinutes] = useState(60);

    const [slotDialogOpen, setSlotDialogOpen] = useState(false);
    const [slotDialogDate, setSlotDialogDate] = useState(localDateStr(new Date()));
    const [slotDialogStartTime, setSlotDialogStartTime] = useState(toTimeInput(nextWholeQuarterHour()));
    const [slotDialogDurationMinutes, setSlotDialogDurationMinutes] = useState(60);

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
            const parsed = parseDurationQuery(duration);
            if (parsed > 0) setDurationMinutes(parsed);
        }
    }, [searchParams]);

    const startAt = useMemo(() => {
        const day = parseYmd(selectedDate);
        if (!day) return getAutoStartForDate(spot, localDateStr(new Date()));
        const normalizedTime = normalizeTimeInput(selectedStartTime);
        return setTime(startOfDay(day), normalizedTime);
    }, [spot, selectedDate, selectedStartTime]);
    const endAt = useMemo(() => addMinutes(startAt, durationMinutes), [startAt, durationMinutes]);
    const startsInFuture = useMemo(() => startAt.getTime() >= Date.now(), [startAt]);

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
        if (!startsInFuture) return { ok: false, label: "Start time must be in the future." };
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
    }, [slotRangeValid, startsInFuture, slotAllowed, slotFull, capacity, spotsLeft]);

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

    const userPoints = toNumber(user?.points_balance);
    const bidPointsInsufficient = bidPayMethod === "points" && bidTotalPoints > 0 && userPoints < bidTotalPoints;

    const auctionSoldOut = !!auctionInfo?.sold_out;
    const auctionClosed = !!spot && spot.mode === "auction" && auctionSoldOut;

    function openSlotDialog(date: string) {
        const autoStart = toTimeInput(getAutoStartForDate(spot, date));
        setSlotDialogDate(date);
        setSlotDialogStartTime(selectedDate === date ? selectedStartTime : autoStart);
        setSlotDialogDurationMinutes(durationMinutes);
        setSlotDialogOpen(true);
    }

    function applySlotDialog() {
        setSelectedDate(slotDialogDate);
        setSelectedStartTime(normalizeTimeInput(slotDialogStartTime));
        setDurationMinutes(clampDurationMinutes(slotDialogDurationMinutes));
        setSlotDialogOpen(false);
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
        if (auctionClosed) return setBidMsg("No slots left for this listing.");
        if (!slotStatus.ok) return setBidMsg(slotStatus.label);

        if (bidPayMethod === "money") {
            const value = Number(bidMoneyPerHour);
            if (!Number.isFinite(value) || value <= 0) return setBidMsg("Enter a valid GBP amount per hour.");
        } else {
            const value = Number(bidPointsPerHour);
            if (!Number.isFinite(value) || value <= 0) return setBidMsg("Enter a valid points amount per hour.");
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

                        {isOwner && (
                            <div className="spotOwnerTools">
                                <div className="spotOwnerFlag">Owner view: this is your own listing.</div>
                                <div className="rowInline spotOwnerActions">
                                    <Link to={`/create-listing?edit=${spot.id}`} className="btn btn-primary">
                                        Edit listing
                                    </Link>
                                    <Link to="/dashboard?tab=manageListings" className="btn">
                                        Go to dashboard
                                    </Link>
                                </div>
                            </div>
                        )}

                        <div className="spotSimpleBadges">
                            <span className="badge">{modeLabel}</span>
                            <span className="badge badge--cool">{priceLabel}</span>
                            <span className="badge">{formatAvailability(spot)}</span>
                            {capacity > 1 && (
                                <span className={`badge ${spotsLeft > 0 ? "badge--green" : "badge--rose"}`}>
                                    {spotsLeft}/{capacity} available
                                </span>
                            )}
                            {auctionClosed && (
                                <span className="badge badge--rose">No slots left</span>
                            )}
                        </div>
                    </div>

                    <div className="card spotSimpleAction">
                        <div className="h3">Choose your slot</div>
                        <p className="tiny muted">Tap a date, then choose start time and duration.</p>

                        <SlotCalendar
                            spot={spot}
                            selectedDate={selectedDate}
                            startAt={startAt}
                            endAt={endAt}
                            onPickDate={openSlotDialog}
                            disabled={busy || bidBusy}
                        />

                        <div className="slotRangeSummary">
                            <span className="tiny muted">Selected slot</span>
                            <span className="badge">{formatDateTime(startAt.toISOString())} {" -> "} {formatDateTime(endAt.toISOString())}</span>
                        </div>

                        <div className={`slotStatus ${slotStatus.ok ? "slotStatus--ok" : "slotStatus--bad"}`}>
                            {slotStatus.label}
                        </div>
                    </div>

                    {spot.mode === "auction" ? (
                        <div className="card spotSimpleAction">
                            <div className="h3">Place a bid</div>
                            <p className="tiny muted">Bids are treated as offers. Owners review and approve them manually.</p>

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
                                        min={0.01}
                                        step={0.25}
                                        value={bidMoneyPerHour}
                                        onChange={(e) => setBidMoneyPerHour(e.target.value)}
                                        placeholder="e.g. 8"
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
                                        min={1}
                                        step={1}
                                        value={bidPointsPerHour}
                                        onChange={(e) => setBidPointsPerHour(e.target.value)}
                                        placeholder="Points per hour"
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

            <SlotDialog
                open={slotDialogOpen}
                dateLabel={slotDialogDate}
                startTime={slotDialogStartTime}
                setStartTime={setSlotDialogStartTime}
                durationMinutes={slotDialogDurationMinutes}
                setDurationMinutes={setSlotDialogDurationMinutes}
                onApply={applySlotDialog}
                onClose={() => setSlotDialogOpen(false)}
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
                    const inRange = isDayInSelectedRange(day, startAt, endAt);
                    const selected = selectedDate === key;

                    return (
                        <button
                            key={key}
                            type="button"
                            className={`slotCalDay ${available ? "slotCalDay--available" : "slotCalDay--off"} ${selected ? "slotCalDay--selected" : ""} ${inRange ? "slotCalDay--range" : ""}`}
                            onClick={() => onPickDate(key)}
                            disabled={disabled || !available}
                        >
                            <span className="slotCalNum">{day.getDate()}</span>
                            {day.getDate() === 1 && <span className="slotCalMonth">{day.toLocaleDateString(undefined, { month: "short" })}</span>}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

type SlotDialogProps = {
    open: boolean;
    dateLabel: string;
    startTime: string;
    setStartTime: (value: string) => void;
    durationMinutes: number;
    setDurationMinutes: (value: number) => void;
    onApply: () => void;
    onClose: () => void;
};

function SlotDialog({
    open,
    dateLabel,
    startTime,
    setStartTime,
    durationMinutes,
    setDurationMinutes,
    onApply,
    onClose,
}: SlotDialogProps) {
    if (!open) return null;

    const parsedDate = parseYmd(dateLabel);
    const slotStart = parsedDate ? setTime(parsedDate, normalizeTimeInput(startTime)) : null;
    const slotEnd = slotStart ? addMinutes(slotStart, durationMinutes) : null;

    return (
        <div className="slotDialogBackdrop" role="dialog" aria-modal="true">
            <div className="card slotDialog">
                <div className="h3">Pick start time and duration</div>
                <div className="tiny muted">{dateLabel}</div>

                <label className="field">
                    <span>Start time</span>
                    <input
                        className="input"
                        type="time"
                        step={900}
                        value={normalizeTimeInput(startTime)}
                        onChange={(e) => setStartTime(normalizeTimeInput(e.target.value))}
                    />
                </label>

                <label className="field">
                    <span>Duration</span>
                    <select
                        className="input"
                        value={durationMinutes}
                        onChange={(e) => setDurationMinutes(clampDurationMinutes(Number(e.target.value)))}
                    >
                        {DURATION_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                </label>

                {slotStart && slotEnd && (
                    <div className="slotDialogPreview">
                        {formatDateTime(slotStart.toISOString())} {" -> "} {formatDateTime(slotEnd.toISOString())}
                    </div>
                )}

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

function isDayInSelectedRange(day: Date, startAt: Date, endAt: Date) {
    const dayStart = startOfDay(day);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    return dayEnd.getTime() > startAt.getTime() && dayStart.getTime() < endAt.getTime();
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
    if (!day) return nextWholeQuarterHour();

    const base = startOfDay(day);
    if (!spot) {
        const fallback = new Date(base);
        if (isSameDay(fallback, new Date())) return nextWholeQuarterHour();
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

    const now = nextWholeQuarterHour();
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

function parseDurationQuery(raw: string) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return clampDurationMinutes(n * 60);
}

function clampDurationMinutes(value: number) {
    if (!Number.isFinite(value)) return 60;

    const bounded = Math.max(15, Math.min(MAX_DURATION_MINUTES, Math.round(value)));
    let closest = DURATION_OPTIONS[0]?.value ?? 60;

    for (const option of DURATION_OPTIONS) {
        if (Math.abs(option.value - bounded) < Math.abs(closest - bounded)) {
            closest = option.value;
        }
    }

    return closest;
}

function buildDurationOptions() {
    const options: Array<{ value: number; label: string }> = [];

    for (let minutes = 15; minutes <= 12 * 60; minutes += 15) {
        options.push({ value: minutes, label: formatDurationLabel(minutes) });
    }

    for (let hours = 13; hours <= 72; hours += 1) {
        const minutes = hours * 60;
        options.push({ value: minutes, label: formatDurationLabel(minutes) });
    }

    for (let days = 4; days <= 30; days += 1) {
        const minutes = days * 24 * 60;
        options.push({ value: minutes, label: formatDurationLabel(minutes) });
    }

    return options;
}

function formatDurationLabel(minutes: number) {
    if (minutes < 60) return `${minutes} min`;
    if (minutes % (24 * 60) === 0) {
        const days = minutes / (24 * 60);
        return days === 1 ? "1 day" : `${days} days`;
    }

    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    if (remainder === 0) return hours === 1 ? "1 hour" : `${hours} hours`;
    return `${hours}h ${remainder}m`;
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

function nextWholeQuarterHour() {
    const now = new Date();
    const d = new Date(now);
    d.setSeconds(0, 0);
    const roundedMinutes = Math.ceil(d.getMinutes() / 15) * 15;
    if (roundedMinutes === 60) {
        d.setHours(d.getHours() + 1, 0, 0, 0);
    } else {
        d.setMinutes(roundedMinutes, 0, 0);
    }
    if (d <= now) d.setMinutes(d.getMinutes() + 15, 0, 0);
    return d;
}

function toTimeInput(date: Date) {
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function normalizeTimeInput(value: string) {
    if (!/^\d{2}:\d{2}$/.test(value)) return "00:00";
    const [hRaw, mRaw] = value.split(":");
    const h = Number(hRaw);
    const m = Number(mRaw);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return "00:00";
    if (h < 0 || h > 23 || m < 0 || m > 59) return "00:00";
    return `${pad2(h)}:${pad2(m)}`;
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
