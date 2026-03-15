import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import SpotsMap from "../components/SpotsMap";
import { AppRadioCards } from "../components/ui/AppChoiceControls";
import { apiGet, apiPost, readErrorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Booking as SharedBooking, ParkingSpot as SharedParkingSpot } from "../types";
import {
    calcAuctionMoneyTotal,
    calcAuctionPointsTotal,
    calcUnitsForMinutes,
    capitalizeLabel,
    formatDateDisplay,
    formatDateTimeCompact,
    formatGbp,
    formatTimeDisplay,
    parseYmd,
    toFiniteNumber,
    toLocalDateInput,
    type PriceUnit,
} from "./pagesShared";
import {
    formatAvailability,
    formatBidAmount,
    getAutoStartForDate,
    isSlotAllowed,
    nextWholeQuarterHour,
    normalizeTimeInput,
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

export default function SpotDetailsPage() {
    const { id } = useParams<{ id: string }>();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { token, user } = useAuth();

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

    const initialStart = useMemo(() => nextWholeQuarterHour(), []);
    const initialEnd = useMemo(() => new Date(initialStart.getTime() + 60 * 60000), [initialStart]);
    const [selectedStartDate, setSelectedStartDate] = useState(() => toLocalDateInput(initialStart));
    const [selectedEndDate, setSelectedEndDate] = useState(() => toLocalDateInput(initialEnd));
    const [selectedStartTime, setSelectedStartTime] = useState(() => toTimeInput(initialStart));
    const [selectedEndTime, setSelectedEndTime] = useState(() => toTimeInput(initialEnd));
    const [hasSelectedSlot, setHasSelectedSlot] = useState(false);
    const [calendarDraftStartDate, setCalendarDraftStartDate] = useState<string | null>(null);
    const [calendarDraftEndDate, setCalendarDraftEndDate] = useState<string | null>(null);
    const [calendarResetNonce, setCalendarResetNonce] = useState(0);

    const initialSlotDraft = useMemo(
        () => ({
            startDate: toLocalDateInput(initialStart),
            endDate: toLocalDateInput(initialEnd),
            startTime: toTimeInput(initialStart),
            endTime: toTimeInput(initialEnd),
        }),
        [initialEnd, initialStart]
    );

    const [slotDialogOpen, setSlotDialogOpen] = useState(false);
    const [slotDialogDraft, setSlotDialogDraft] = useState(() => initialSlotDraft);

    const [payMethod, setPayMethod] = useState<PayMethod>("money");

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

        if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
            setSelectedStartDate(date);
            setSelectedEndDate(date);
            setHasSelectedSlot(true);
        }
    }, [searchParams]);

    const startAt = useMemo(() => {
        const day = parseYmd(selectedStartDate);
        if (!day) return getAutoStartForDate(spot, toLocalDateInput(new Date()));
        const normalizedTime = normalizeTimeInput(selectedStartTime);
        return setTime(startOfDay(day), normalizedTime);
    }, [spot, selectedStartDate, selectedStartTime]);
    const endAt = useMemo(() => {
        const day = parseYmd(selectedEndDate);
        if (!day) return startAt;
        const normalizedTime = normalizeTimeInput(selectedEndTime);
        return setTime(startOfDay(day), normalizedTime);
    }, [selectedEndDate, selectedEndTime, startAt]);
    const startsInFuture = useMemo(() => startAt.getTime() >= Date.now(), [startAt]);
    const selectedMinutes = useMemo(
        () => Math.max(0, Math.round((endAt.getTime() - startAt.getTime()) / 60000)),
        [endAt, startAt]
    );

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

    const isOwner = !!user && !!spot && user.id === spot.owner_user_id;
    const listingInactive = !!spot && !spot.is_active;

    const slotStatus = useMemo(() => {
        if (!hasSelectedSlot) return { ok: false, label: "Choose a slot to continue." };
        if (listingInactive) return { ok: false, label: "This listing is no longer active." };
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
    }, [hasSelectedSlot, listingInactive, slotRangeValid, startsInFuture, slotAllowed, slotFull, capacity, spotsLeft]);

    const listingUnit = (spot?.price_unit ?? "hour") as PriceUnit;
    const estimatedTotal = useMemo(() => {
        if (!spot || spot.mode === "free") return 0;
        const units = calcUnitsForMinutes(selectedMinutes, listingUnit);
        return roundMoney(listingPrice * units);
    }, [spot, selectedMinutes, listingUnit, listingPrice]);

    const pointsMinTotal = useMemo(() => {
        if (!canUsePoints || !spot) return 0;
        const units = calcUnitsForMinutes(selectedMinutes, listingUnit);
        return Math.ceil(toFiniteNumber(spot.points_cost) * units);
    }, [canUsePoints, spot, selectedMinutes, listingUnit]);

    const auctionMinPerUnit = toFiniteNumber(spot?.auction_start_price_gbp);
    const bidUnits = useMemo(() => calcUnitsForMinutes(selectedMinutes, listingUnit, "auction"), [selectedMinutes, listingUnit]);
    const bidTotalMoney = useMemo(() => {
        return calcAuctionMoneyTotal(bidMoneyPerHour, bidUnits);
    }, [bidMoneyPerHour, bidUnits]);

    const bidTotalPoints = useMemo(() => {
        return calcAuctionPointsTotal(bidPointsPerHour, bidUnits);
    }, [bidPointsPerHour, bidUnits]);

    const userPoints = toFiniteNumber(user?.points_balance);
    const bidPointsInsufficient = bidPayMethod === "points" && bidTotalPoints > 0 && userPoints < bidTotalPoints;

    const auctionSoldOut = !!auctionInfo?.sold_out;
    const auctionClosed = !!spot && spot.mode === "auction" && auctionSoldOut;

    function pickCalendarDate(date: string) {
        if (!calendarDraftStartDate || calendarDraftEndDate) {
            setCalendarDraftStartDate(date);
            setCalendarDraftEndDate(null);
            return;
        }

        if (date < calendarDraftStartDate) {
            setCalendarDraftStartDate(date);
            setCalendarDraftEndDate(null);
            return;
        }

        const draftStartDate = calendarDraftStartDate;
        const autoStart = draftStartDate === selectedStartDate ? selectedStartTime : toTimeInput(getAutoStartForDate(spot, draftStartDate));
        const autoEnd =
            date === selectedEndDate
                ? selectedEndTime
                : date === draftStartDate
                    ? toTimeInput(new Date(getAutoStartForDate(spot, draftStartDate).getTime() + 60 * 60000))
                    : autoStart;

        setSlotDialogDraft({
            startDate: draftStartDate,
            endDate: date,
            startTime: autoStart,
            endTime: autoEnd,
        });
        setCalendarDraftEndDate(date);
        setSlotDialogOpen(true);
    }

    function applySlotDialog() {
        setSelectedStartDate(slotDialogDraft.startDate);
        setSelectedEndDate(slotDialogDraft.endDate);
        setSelectedStartTime(normalizeTimeInput(slotDialogDraft.startTime));
        setSelectedEndTime(normalizeTimeInput(slotDialogDraft.endTime));
        setHasSelectedSlot(true);
        setCalendarDraftStartDate(null);
        setCalendarDraftEndDate(null);
        setSlotDialogOpen(false);
    }

    function closeSlotDialog() {
        setSlotDialogOpen(false);
        setCalendarDraftStartDate(null);
        setCalendarDraftEndDate(null);
    }

    function resetCalendarSelection() {
        setSlotDialogOpen(false);
        setCalendarDraftStartDate(null);
        setCalendarDraftEndDate(null);
        setSelectedStartDate(initialSlotDraft.startDate);
        setSelectedEndDate(initialSlotDraft.endDate);
        setSelectedStartTime(initialSlotDraft.startTime);
        setSelectedEndTime(initialSlotDraft.endTime);
        setSlotDialogDraft(initialSlotDraft);
        setHasSelectedSlot(false);
        setActionMsg(null);
        setBidMsg(null);
        setCalendarResetNonce((value) => value + 1);
    }

    const calendarStartDate = calendarDraftStartDate ?? (hasSelectedSlot ? selectedStartDate : "");
    const calendarEndDate =
        calendarDraftStartDate && !calendarDraftEndDate
            ? null
            : hasSelectedSlot
                ? calendarDraftEndDate ?? selectedEndDate
                : null;
    const calendarAnchorDate = calendarDraftStartDate ?? selectedStartDate;

    async function createBooking() {
        if (!token) return setActionMsg("Please log in to book this listing.");
        if (!spot || spot.mode === "auction") return;
        if (listingInactive) return setActionMsg("This listing is no longer active.");
        if (isOwner) return setActionMsg("You cannot book your own listing.");
        if (!slotStatus.ok) return setActionMsg(slotStatus.label);
        if (payMethod === "money" && !canUseMoneyBooking) return setActionMsg("This listing accepts points only.");
        if (payMethod === "points" && pointsMinTotal <= 0) return setActionMsg("Points pricing is not available for this slot.");

        setBusy(true);
        setActionMsg(null);

        try {
            const body: Record<string, unknown> = {
                parking_spot_id: spot.id,
                start_time: startAt.toISOString(),
                end_time: endAt.toISOString(),
                pay_method: payMethod,
            };

            if (payMethod === "points") body.points_amount = pointsMinTotal;

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
        if (listingInactive) return setBidMsg("This listing is no longer active.");
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
                ? `Bid from ${formatGbp(auctionMinPerUnit)} / ${listingUnit}`
                : `${formatGbp(listingPrice)} / ${listingUnit}`;

    const pendingBids = auctionInfo?.pending_bids ?? [];

    return (
        <div className="container">
            <div className="spotSimple">
                <aside className="spotSimpleSide">
                    <div className="card spotSimpleMedia">
                        <div className="h3">Map</div>
                        <div className="spotMapWrap" style={{ marginTop: 10 }}>
                            <SpotsMap
                                spots={[spot]}
                                center={{ lat: spot.lat, lng: spot.lng }}
                                selectedId={spot.id}
                                showPopupDetails={false}
                            />
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
                            {listingInactive && <span className="badge badge--rose">Inactive</span>}
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
                        <p className="tiny muted" style={{ margin: "0 0 6px" }}>
                            Tap a start date, then an end date, then choose the exact times.
                        </p>

                        <SlotCalendar
                            key={`${calendarAnchorDate.slice(0, 7)}-${calendarResetNonce}`}
                            spot={spot}
                            startDate={calendarStartDate}
                            endDate={calendarEndDate}
                            onPickDate={pickCalendarDate}
                            disabled={busy || bidBusy || listingInactive}
                        />

                        <div className="rowInline" style={{ justifyContent: "flex-end", marginTop: 8 }}>
                            <button
                                type="button"
                                className="btn"
                                onClick={resetCalendarSelection}
                                disabled={busy || bidBusy || listingInactive}
                                style={{ padding: "6px 12px", fontSize: 12 }}
                            >
                                Reset
                            </button>
                        </div>

                        <div className="slotRangeSummary">
                            <div className="slotRangeSummaryHead">
                                <span className="tiny muted">Selected slot</span>
                                <span className="badge">{hasSelectedSlot ? "Ready to book" : "No slot selected yet"}</span>
                            </div>

                            {hasSelectedSlot ? (
                                <>
                                    <div className="slotRangeGrid">
                                        <div className="slotRangeCard">
                                            <span className="slotRangeCardLabel">Start</span>
                                            <strong>{formatTimeDisplay(startAt)}</strong>
                                            <span>{formatDateDisplay(startAt)}</span>
                                        </div>

                                        <div className="slotRangeCard">
                                            <span className="slotRangeCardLabel">End</span>
                                            <strong>{formatTimeDisplay(endAt)}</strong>
                                            <span>{formatDateDisplay(endAt)}</span>
                                        </div>
                                    </div>

                                    <div className="slotRangeFoot">
                                        {formatDateTimeCompact(startAt.toISOString())} {" -> "} {formatDateTimeCompact(endAt.toISOString())}
                                    </div>
                                </>
                            ) : (
                                <div className="slotRangeEmpty">Choose your dates, then set the exact start and end times.</div>
                            )}
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
                            {listingInactive && <div className="spotAlert">This listing is no longer active for new bids.</div>}

                            <AppRadioCards
                                ariaLabel="Bid payment method"
                                className="payToggle"
                                itemClassName="payToggleBtn"
                                activeClassName="active"
                                orientation="horizontal"
                                value={bidPayMethod}
                                onChange={setBidPayMethod}
                                isDisabled={auctionClosed || bidBusy || listingInactive}
                                options={[
                                    ...(canUseMoneyBids ? [{ id: "money" as const, content: "Money" }] : []),
                                    ...(canUsePoints ? [{ id: "points" as const, content: "Points" }] : []),
                                ]}
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
                                        disabled={auctionClosed || bidBusy || listingInactive}
                                    />
                                    <div className="tiny muted">Estimated total: {bidTotalMoney > 0 ? formatGbp(bidTotalMoney) : "-"}</div>
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
                                        disabled={auctionClosed || bidBusy || listingInactive}
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
                                    disabled={!token || isOwner || auctionClosed || bidBusy || listingInactive || !slotStatus.ok}
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
                            {listingInactive && <div className="spotAlert">This listing is no longer active for new bookings.</div>}

                            <div className="spotSimpleInlineMeta">
                                <span className="tiny muted">Estimated total</span>
                                <span className="badge">{spot.mode === "free" ? "Free" : formatGbp(estimatedTotal)}</span>
                            </div>

                            <AppRadioCards
                                ariaLabel="Booking payment method"
                                className="payToggle"
                                itemClassName="payToggleBtn"
                                activeClassName="active"
                                orientation="horizontal"
                                value={payMethod}
                                onChange={setPayMethod}
                                isDisabled={busy || listingInactive}
                                options={[
                                    ...(canUseMoneyBooking ? [{ id: "money" as const, content: "Card" }] : []),
                                    ...(canUsePoints ? [{ id: "points" as const, content: "Points" }] : []),
                                ]}
                            />

                            <div className="rowInline" style={{ marginTop: 4 }}>
                                <button
                                    onClick={createBooking}
                                    className="btn btn-primary"
                                    disabled={!token || isOwner || busy || listingInactive || !slotStatus.ok}
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
                spot={spot}
                startDateLabel={slotDialogDraft.startDate}
                endDateLabel={slotDialogDraft.endDate}
                startTime={slotDialogDraft.startTime}
                setStartTime={(value) => setSlotDialogDraft((prev) => ({ ...prev, startTime: value }))}
                endTime={slotDialogDraft.endTime}
                setEndTime={(value) => setSlotDialogDraft((prev) => ({ ...prev, endTime: value }))}
                onApply={applySlotDialog}
                onClose={closeSlotDialog}
            />
        </div>
    );
}

