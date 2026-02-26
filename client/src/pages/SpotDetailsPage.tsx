import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import SpotsMap from "../components/SpotsMap";
import { apiGet, apiPost, readErrorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Booking as SharedBooking, ParkingSpot as SharedParkingSpot } from "../types";
import {
    calcUnitsForMinutes,
    capitalizeLabel,
    formatDateTimeCompact,
    parseYmd,
    toFiniteNumber,
    toLocalDateInput,
    type PriceUnit,
} from "./pagesShared";
import {
    addMinutes,
    clampDurationMinutes,
    formatAvailability,
    formatBidAmount,
    getAutoStartForDate,
    isSlotAllowed,
    nextWholeQuarterHour,
    normalizeTimeInput,
    parseDurationQuery,
    roundMoney,
    setTime,
    SlotCalendar,
    SlotDialog,
    startOfDay,
    toTimeInput,
    type AvailabilityJson,
} from "./spotDetailsSupport";

type PayMethod = "money" | "points";

type ParkingSpot = Omit<SharedParkingSpot, "price_gbp" | "availability_json"> & {
    price_gbp: number | string;
    availability_json?: AvailabilityJson | null;
};

type SpotBooking = Pick<SharedBooking, "id" | "start_time" | "end_time" | "status" | "pay_method" | "total_price_gbp">;
type AuctionBid = { id: string; amount_gbp?: number; amount_points?: number; pay_method?: PayMethod; status: string; start_time?: string; end_time?: string; bidder_name?: string; bidder_email?: string };
type AuctionInfo = { pending_bids?: AuctionBid[]; sold_out?: boolean };

function PayMethodToggle({
    value,
    onChange,
    canUseMoney = true,
    canUsePoints,
    moneyLabel = "Money",
    pointsLabel = "Points",
    disabled = false,
}: {
    value: PayMethod;
    onChange: (next: PayMethod) => void;
    canUseMoney?: boolean;
    canUsePoints: boolean;
    moneyLabel?: string;
    pointsLabel?: string;
    disabled?: boolean;
}) {
    return (
        <div className="payToggle">
            {canUseMoney && (
                <button
                    type="button"
                    className={`payToggleBtn ${value === "money" ? "active" : ""}`}
                    onClick={() => onChange("money")}
                    disabled={disabled}
                >
                    {moneyLabel}
                </button>
            )}
            {canUsePoints && (
                <button
                    type="button"
                    className={`payToggleBtn ${value === "points" ? "active" : ""}`}
                    onClick={() => onChange("points")}
                    disabled={disabled}
                >
                    {pointsLabel}
                </button>
            )}
        </div>
    );
}

export default function SpotDetailsPage() {
    const { id } = useParams<{ id: string }>();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { token, user } = useAuth();

    // credit: server-state loading/caching pattern follows TanStack Query docs (https://tanstack.com/query)
    const spotQuery = useQuery({
        queryKey: ["spot", id],
        enabled: !!id,
        queryFn: async () => {
            const response = await apiGet<{ parking_spot: ParkingSpot }>(`/parking-spots/${id}`);
            return response.parking_spot ?? null;
        },
        refetchOnWindowFocus: false,
    });

    const bookingsQuery = useQuery({
        queryKey: ["spot-bookings", id],
        enabled: !!id,
        queryFn: async () => {
            try {
                const response = await apiGet<{ bookings: SpotBooking[] }>(`/bookings/spot/${id}`);
                return response.bookings ?? [];
            } catch {
                return [] as SpotBooking[];
            }
        },
        refetchOnWindowFocus: false,
    });

    const [selectedDate, setSelectedDate] = useState(toLocalDateInput(new Date()));
    const [selectedStartTime, setSelectedStartTime] = useState(() => toTimeInput(nextWholeQuarterHour()));
    const [durationMinutes, setDurationMinutes] = useState(60);

    const [slotDialogOpen, setSlotDialogOpen] = useState(false);
    const [slotDialogDraft, setSlotDialogDraft] = useState(() => ({
        date: toLocalDateInput(new Date()),
        startTime: toTimeInput(nextWholeQuarterHour()),
        durationMinutes: 60,
    }));

    const [payMethod, setPayMethod] = useState<PayMethod>("money");
    const [pointsAmount, setPointsAmount] = useState("");

    const [bidPayMethod, setBidPayMethod] = useState<PayMethod>("money");
    const [bidMoneyPerHour, setBidMoneyPerHour] = useState("");
    const [bidPointsPerHour, setBidPointsPerHour] = useState("");

    const [actionMsg, setActionMsg] = useState<string | null>(null);
    const [bidMsg, setBidMsg] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [bidBusy, setBidBusy] = useState(false);

    const spot = spotQuery.data ?? null;
    const bookings = useMemo(() => bookingsQuery.data ?? [], [bookingsQuery.data]);
    const auctionQuery = useQuery({
        queryKey: ["spot-auction", spot?.id, token ? "auth" : "anon"],
        enabled: !!spot && spot.mode === "auction",
        queryFn: async () => {
            try {
                const summary = token
                    ? await apiGet<{ auction: AuctionInfo }>(`/auctions/${spot?.id}`, token)
                    : await apiGet<{ auction: AuctionInfo }>(`/auctions/${spot?.id}`);
                return summary.auction ?? null;
            } catch {
                return null as AuctionInfo | null;
            }
        },
        refetchInterval: 10000,
        refetchOnWindowFocus: false,
    });
    const auctionInfo = auctionQuery.data ?? null;

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
        if (!day) return getAutoStartForDate(spot, toLocalDateInput(new Date()));
        const normalizedTime = normalizeTimeInput(selectedStartTime);
        return setTime(startOfDay(day), normalizedTime);
    }, [spot, selectedDate, selectedStartTime]);
    const endAt = useMemo(() => addMinutes(startAt, durationMinutes), [startAt, durationMinutes]);
    const startsInFuture = useMemo(() => startAt.getTime() >= Date.now(), [startAt]);

    const canUsePoints = !!spot?.allow_points && toFiniteNumber(spot.points_cost) > 0;

    useEffect(() => {
        if (!canUsePoints && payMethod === "points") setPayMethod("money");
    }, [canUsePoints, payMethod]);

    const listingPrice = toFiniteNumber(spot?.price_gbp);
    const canUseMoneyBooking = !!spot && spot.mode !== "free" && listingPrice > 0;
    const canUseMoneyBids = !spot || spot.mode !== "auction" || toFiniteNumber(spot.auction_start_price_gbp) >= 0.1;

    useEffect(() => {
        if (!canUseMoneyBooking && payMethod === "money" && canUsePoints) setPayMethod("points");
    }, [canUseMoneyBooking, canUsePoints, payMethod]);

    useEffect(() => {
        if (!canUsePoints && bidPayMethod === "points") setBidPayMethod("money");
    }, [canUsePoints, bidPayMethod]);

    useEffect(() => {
        if (!canUseMoneyBids && bidPayMethod === "money" && canUsePoints) setBidPayMethod("points");
    }, [canUseMoneyBids, canUsePoints, bidPayMethod]);

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

    const capacity = Math.max(1, toFiniteNumber(spot?.capacity_total || 1));
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

    const listingUnit = (spot?.price_unit ?? "hour") as PriceUnit;
    const estimatedTotal = useMemo(() => {
        if (!spot || spot.mode === "free") return 0;
        const units = calcUnitsForMinutes(durationMinutes, listingUnit);
        return roundMoney(listingPrice * units);
    }, [spot, durationMinutes, listingUnit, listingPrice]);

    const pointsMinTotal = useMemo(() => {
        if (!canUsePoints || !spot) return 0;
        const units = calcUnitsForMinutes(durationMinutes, listingUnit);
        return Math.ceil(toFiniteNumber(spot.points_cost) * units);
    }, [canUsePoints, spot, durationMinutes, listingUnit]);

    useEffect(() => {
        if (payMethod !== "points" || pointsMinTotal <= 0) return;
        const value = Number(pointsAmount);
        if (!Number.isFinite(value) || value < pointsMinTotal) setPointsAmount(String(pointsMinTotal));
    }, [payMethod, pointsMinTotal, pointsAmount]);

    const auctionMinPerUnit = toFiniteNumber(spot?.auction_start_price_gbp);
    const bidUnits = useMemo(() => calcUnitsForMinutes(durationMinutes, listingUnit), [durationMinutes, listingUnit]);
    const bidTotalMoney = useMemo(() => {
        const perUnit = Number(bidMoneyPerHour);
        if (!Number.isFinite(perUnit) || perUnit <= 0) return 0;
        return roundMoney(perUnit * bidUnits);
    }, [bidMoneyPerHour, bidUnits]);

    const bidTotalPoints = useMemo(() => {
        const perUnit = Number(bidPointsPerHour);
        if (!Number.isFinite(perUnit) || perUnit <= 0) return 0;
        return Math.ceil(perUnit * bidUnits);
    }, [bidPointsPerHour, bidUnits]);

    const userPoints = toFiniteNumber(user?.points_balance);
    const bidPointsInsufficient = bidPayMethod === "points" && bidTotalPoints > 0 && userPoints < bidTotalPoints;

    const auctionSoldOut = !!auctionInfo?.sold_out;
    const auctionClosed = !!spot && spot.mode === "auction" && auctionSoldOut;

    function openSlotDialog(date: string) {
        const autoStart = toTimeInput(getAutoStartForDate(spot, date));
        setSlotDialogDraft({
            date,
            startTime: selectedDate === date ? selectedStartTime : autoStart,
            durationMinutes,
        });
        setSlotDialogOpen(true);
    }

    function applySlotDialog() {
        setSelectedDate(slotDialogDraft.date);
        setSelectedStartTime(normalizeTimeInput(slotDialogDraft.startTime));
        setDurationMinutes(clampDurationMinutes(slotDialogDraft.durationMinutes));
        setSlotDialogOpen(false);
    }

    async function createBooking() {
        if (!token) return setActionMsg("Please log in to book this listing.");
        if (!spot || spot.mode === "auction") return;
        if (isOwner) return setActionMsg("You cannot book your own listing.");
        if (!slotStatus.ok) return setActionMsg(slotStatus.label);
        if (payMethod === "money" && !canUseMoneyBooking) return setActionMsg("This listing accepts points only.");

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
            await bookingsQuery.refetch();

            const needsPayment =
                booking?.pay_method === "money" &&
                toFiniteNumber(booking?.total_price_gbp) > 0 &&
                booking?.status === "pending" &&
                booking?.id;

            if (needsPayment) return navigate(`/pay/${booking.id}`);
            navigate("/dashboard?tab=myBookings");
        } catch (error: unknown) {
            setActionMsg(readErrorMessage(error, "Booking failed."));
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
            if (!canUseMoneyBids) return setBidMsg("This auction accepts points only.");
            const value = Number(bidMoneyPerHour);
            if (!Number.isFinite(value) || value <= 0) return setBidMsg(`Enter a valid GBP amount per ${listingUnit}.`);
        } else {
            const value = Number(bidPointsPerHour);
            if (!Number.isFinite(value) || value <= 0) return setBidMsg(`Enter a valid points amount per ${listingUnit}.`);
            if (bidPointsInsufficient) return setBidMsg(`You need ${bidTotalPoints} pts, you have ${userPoints}.`);
        }

        const params = new URLSearchParams({
            spotId: spot.id,
            start: startAt.toISOString(),
            end: endAt.toISOString(),
            pay: bidPayMethod,
            moneyPerUnit: bidPayMethod === "money" ? bidMoneyPerHour : "",
            pointsPerUnit: bidPayMethod === "points" ? bidPointsPerHour : "",
        });

        navigate(`/bids/confirm?${params.toString()}`);
    }

    async function acceptBid(bidId: string) {
        if (!token || !spot) return;
        setBidBusy(true);
        try {
            await apiPost(`/auctions/${spot.id}/accept`, { bid_id: bidId }, token);
            await Promise.all([auctionQuery.refetch(), bookingsQuery.refetch()]);
            setBidMsg("Bid accepted.");
        } catch (error: unknown) {
            setBidMsg(readErrorMessage(error, "Failed to accept bid."));
        } finally {
            setBidBusy(false);
        }
    }

    if (spotQuery.isPending) return <div style={{ padding: 24 }}>Loading listing...</div>;
    if (spotQuery.isError) return <div style={{ padding: 24, color: "crimson" }}>{readErrorMessage(spotQuery.error, "Failed to load listing.")}</div>;
    if (!spot) return <div style={{ padding: 24 }}>Listing not found.</div>;

    const modeLabel = capitalizeLabel(spot.mode);
    const priceLabel =
        spot.mode === "free"
            ? "Free"
            : spot.mode === "auction"
                ? `Bid from GBP ${auctionMinPerUnit.toFixed(2)} / ${listingUnit}`
                : `GBP ${listingPrice.toFixed(2)} / ${listingUnit}`;

    const pendingBids = auctionInfo?.pending_bids ?? [];

    return (
        <div className="container">
            <div className="spotSimple">
                <aside className="spotSimpleSide">
                    <div className="card spotSimpleMedia">
                        <div className="h3">Map</div>
                        <div className="spotMapWrap" style={{ marginTop: 10 }}>
                            <SpotsMap spots={[spot]} center={{ lat: spot.lat, lng: spot.lng }} selectedId={spot.id} />
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
                            key={selectedDate.slice(0, 7)}
                            spot={spot}
                            selectedDate={selectedDate}
                            startAt={startAt}
                            endAt={endAt}
                            onPickDate={openSlotDialog}
                            disabled={busy || bidBusy}
                        />

                        <div className="slotRangeSummary">
                            <span className="tiny muted">Selected slot</span>
                            <span className="badge">{formatDateTimeCompact(startAt.toISOString())} {" -> "} {formatDateTimeCompact(endAt.toISOString())}</span>
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

                            <PayMethodToggle
                                value={bidPayMethod}
                                onChange={setBidPayMethod}
                                canUseMoney={canUseMoneyBids}
                                canUsePoints={canUsePoints}
                                disabled={auctionClosed || bidBusy}
                            />

                            {bidPayMethod === "money" ? (
                                <label>
                                    <span>Bid per {listingUnit} (GBP)</span>
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
                                    <span>Bid per {listingUnit} (points)</span>
                                    <input
                                        className="input"
                                        type="number"
                                        min={1}
                                        step={1}
                                        value={bidPointsPerHour}
                                        onChange={(e) => setBidPointsPerHour(e.target.value)}
                                        placeholder={`Points per ${listingUnit}`}
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

                            <PayMethodToggle
                                value={payMethod}
                                onChange={setPayMethod}
                                canUseMoney={canUseMoneyBooking}
                                canUsePoints={canUsePoints}
                                moneyLabel="Card"
                                disabled={busy}
                            />

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
                                    <div
                                        key={bid.id}
                                        className={`spotSimpleBid${["pending", "accepted", "rejected", "declined", "won"].includes(bid.status) ? ` ${bid.status}` : ""}`}
                                    >
                                        <div className="rowInline" style={{ justifyContent: "space-between", gap: 10 }}>
                                            <strong>{formatBidAmount(bid)}</strong>
                                            <button className="btn btn-primary" onClick={() => acceptBid(bid.id)} disabled={bidBusy}>
                                                {bidBusy ? "Working..." : "Accept"}
                                            </button>
                                        </div>
                                        <div className="tiny muted">{bid.bidder_name || bid.bidder_email || "Bidder"}</div>
                                        {bid.start_time && bid.end_time && (
                                            <div className="tiny muted">{formatDateTimeCompact(bid.start_time)} {" -> "} {formatDateTimeCompact(bid.end_time)}</div>
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
                dateLabel={slotDialogDraft.date}
                startTime={slotDialogDraft.startTime}
                setStartTime={(value) => setSlotDialogDraft((prev) => ({ ...prev, startTime: value }))}
                durationMinutes={slotDialogDraft.durationMinutes}
                setDurationMinutes={(value) => setSlotDialogDraft((prev) => ({ ...prev, durationMinutes: value }))}
                onApply={applySlotDialog}
                onClose={() => setSlotDialogOpen(false)}
            />
        </div>
    );
}

