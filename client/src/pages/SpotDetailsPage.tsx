import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import AppPageState from "../components/AppPageState";
import SpotsMap from "../components/SpotsMap";
import { AppRadioCards } from "../components/ui/AppChoiceControls";
import { apiGet, apiPost, readErrorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Booking as SharedBooking, ParkingSpot as SharedParkingSpot } from "../types";
import {
    calcAuctionMoneyTotal,
    calcMinimumAuctionMoneyPerUnit,
    calcMinimumAuctionMoneyTotal,
    calcAuctionPointsTotal,
    calcUnitsForMinutes,
    capitalizeLabel,
    formatDateDisplay,
    formatGbp,
    STRIPE_MIN_GBP_PAYMENT,
    formatTimeDisplay,
    parseYmd,
    toFiniteNumber,
    toLocalDateInput,
    type PriceUnit,
} from "./pagesShared";
import {
    formatAvailability,
    getAutoStartForDate,
    getRangeCapacityState,
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
import { listingFeatureLabel, listingFeatureTone } from "./createListingSupport";

type PayMethod = "money" | "points";

type ParkingSpot = Omit<SharedParkingSpot, "price_gbp" | "availability_json"> & {
    price_gbp: number | string;
    availability_json?: AvailabilityJson | null;
};

type SpotBooking = Pick<SharedBooking, "id" | "start_time" | "end_time" | "status" | "pay_method" | "total_price_gbp">;
type AuctionInfo = { sold_out?: boolean };

export default function SpotDetailsPage() {
    const { id } = useParams<{ id: string }>();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
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

    const spot = spotQuery.data ?? null;
    const bookings = useMemo(() => bookingsQuery.data ?? [], [bookingsQuery.data]);
    const auctionQuery = useQuery({
        queryKey: ["spot-auction", spot?.id],
        enabled: !!spot && spot.mode === "auction",
        queryFn: async () => {
            try {
                const summary = await apiGet<{ auction: AuctionInfo }>(`/auctions/${spot?.id}`);
                return summary.auction ?? null;
            } catch {
                return null as AuctionInfo | null;
            }
        },
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

    useEffect(() => {
        setActionMsg(null);
    }, [payMethod, selectedEndDate, selectedEndTime, selectedStartDate, selectedStartTime]);

    useEffect(() => {
        setBidMsg(null);
    }, [bidMoneyPerHour, bidPayMethod, bidPointsPerHour, selectedEndDate, selectedEndTime, selectedStartDate, selectedStartTime]);

    const canUsePoints = !!spot?.allow_points && toFiniteNumber(spot.points_cost) > 0;

    useEffect(() => {
        if (!canUsePoints && payMethod === "points") setPayMethod("money");
    }, [canUsePoints, payMethod]);

    const listingPrice = toFiniteNumber(spot?.price_gbp);
    const canUseMoneyBooking = !!spot && (spot.mode === "free" || listingPrice > 0);
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
    }, [endAt, spot, startAt, slotRangeValid]);

    const capacity = Math.max(1, toFiniteNumber(spot?.capacity_total || 1));
    const selectedCapacity = useMemo(() => {
        if (!slotRangeValid) {
            return { maxBooked: 0, spacesLeft: capacity, isFull: false };
        }
        return getRangeCapacityState(bookings, startAt, endAt, capacity);
    }, [bookings, capacity, endAt, slotRangeValid, startAt]);
    const slotFull = selectedCapacity.isFull;

    const isOwner = !!user && !!spot && user.id === spot.owner_user_id;
    const listingInactive = !!spot && !spot.is_active;

    const slotStatus = useMemo(() => {
        if (!hasSelectedSlot) return { ok: false, label: "" };
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
        return { ok: true, label: "Slot is available." };
    }, [hasSelectedSlot, listingInactive, slotRangeValid, startsInFuture, slotAllowed, slotFull, capacity]);

    const listingUnit = (spot?.price_unit ?? "hour") as PriceUnit;
    const estimatedTotal = useMemo(() => {
        if (!spot || spot.mode === "free") return 0;
        const units = calcUnitsForMinutes(selectedMinutes, listingUnit);
        return roundMoney(listingPrice * units);
    }, [spot, selectedMinutes, listingUnit, listingPrice]);
    const isFreeBooking = !!spot && spot.mode !== "auction" && estimatedTotal <= 0;

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
    const auctionBaseMinimumTotal = useMemo(() => calcAuctionMoneyTotal(auctionMinPerUnit, bidUnits), [auctionMinPerUnit, bidUnits]);
    const auctionRequiredMinimumTotal = useMemo(
        () => calcMinimumAuctionMoneyTotal(auctionMinPerUnit, bidUnits),
        [auctionMinPerUnit, bidUnits]
    );
    const auctionRequiredMinPerUnit = useMemo(
        () => calcMinimumAuctionMoneyPerUnit(auctionMinPerUnit, bidUnits),
        [auctionMinPerUnit, bidUnits]
    );

    const bidTotalPoints = useMemo(() => {
        return calcAuctionPointsTotal(bidPointsPerHour, bidUnits);
    }, [bidPointsPerHour, bidUnits]);
    const bookingMoneyBelowMinimum =
        payMethod === "money" && estimatedTotal > 0 && estimatedTotal < STRIPE_MIN_GBP_PAYMENT;
    const bidMoneyBelowMinimum =
        bidPayMethod === "money" && bidTotalMoney > 0 && bidTotalMoney < auctionRequiredMinimumTotal;
    const auctionMoneyMinimumLabel =
        auctionMinPerUnit > 0
            ? `Minimum ${formatGbp(auctionRequiredMinPerUnit)} / ${listingUnit}${auctionRequiredMinimumTotal > auctionBaseMinimumTotal ? " for this slot" : ""}`
            : null;
    const auctionPointsStartPerUnit = toFiniteNumber(spot?.points_cost);
    const auctionPointsStartLabel =
        auctionPointsStartPerUnit > 0 ? `Starting bid: ${auctionPointsStartPerUnit} pts / ${listingUnit}` : null;
    const featureBadges = Array.isArray(spot?.availability_json?.features)
        ? spot.availability_json.features.filter((feature): feature is string => typeof feature === "string" && feature.trim().length > 0)
        : [];

    const userPoints = toFiniteNumber(user?.points_balance);
    const pointsBookingInsufficient = payMethod === "points" && pointsMinTotal > 0 && userPoints < pointsMinTotal;
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
    async function createBooking() {
        if (!token) return;
        if (!spot || spot.mode === "auction") return;
        if (listingInactive) return setActionMsg("This listing is no longer active.");
        if (isOwner) return setActionMsg("You cannot book your own listing.");
        if (!hasSelectedSlot) return setActionMsg("Select a slot before continuing.");
        if (!slotStatus.ok) return setActionMsg(slotStatus.label);
        if (payMethod === "money" && !canUseMoneyBooking) return setActionMsg("This listing accepts points only.");
        if (bookingMoneyBelowMinimum) {
            return setActionMsg(
                `Card payments in GBP must be at least ${formatGbp(STRIPE_MIN_GBP_PAYMENT)}. Pick a longer slot or use points instead.`
            );
        }
        if (payMethod === "points" && pointsMinTotal <= 0) return setActionMsg("Points pricing is not available for this slot.");
        if (pointsBookingInsufficient) return setActionMsg(`You need ${pointsMinTotal} pts, you have ${userPoints}.`);

        if (payMethod === "points") {
            const params = new URLSearchParams({
                spotId: spot.id,
                start: startAt.toISOString(),
                end: endAt.toISOString(),
            });
            navigate(`/bookings/confirm?${params.toString()}`);
            return;
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

            const r = await apiPost<{ booking: SpotBooking }>("/bookings", body, token);
            const booking = r.booking;
            await bookingsQuery.refetch();
            await queryClient.invalidateQueries({ queryKey: ["notification-summary"] });

            const needsPayment =
                booking?.pay_method === "money" &&
                toFiniteNumber(booking?.total_price_gbp) > 0 &&
                booking?.status === "pending" &&
                booking?.id;

            if (needsPayment) return navigate(`/pay/${booking.id}`);
            if (booking?.id) return navigate(`/pay/${booking.id}`);
            navigate("/dashboard?tab=myBookings");
        } catch (error: unknown) {
            setActionMsg(readErrorMessage(error, "Booking failed."));
        } finally {
            setBusy(false);
        }
    }

    function goToBidConfirm() {
        if (!spot || spot.mode !== "auction") return;
        if (!token) return;
        if (listingInactive) return setBidMsg("This listing is no longer active.");
        if (isOwner) return setBidMsg("Owners cannot bid on their own listing.");
        if (auctionClosed) return setBidMsg("No slots left for this listing.");
        if (!hasSelectedSlot) return setBidMsg("Select a slot before continuing.");
        if (!slotStatus.ok) return setBidMsg(slotStatus.label);

        if (bidPayMethod === "money") {
            if (!canUseMoneyBids) return setBidMsg("This auction accepts points only.");
            const value = Number(bidMoneyPerHour);
            if (!Number.isFinite(value) || value <= 0) return setBidMsg(`Enter a valid GBP amount per ${listingUnit}.`);
            if (bidMoneyBelowMinimum) {
                return setBidMsg(
                    `Money bids for this slot must be at least ${formatGbp(auctionRequiredMinPerUnit)} / ${listingUnit}, which totals ${formatGbp(auctionRequiredMinimumTotal)}. Increase the bid or use points instead.`
                );
            }
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

    if (spotQuery.isPending) return null;
    if (spotQuery.isError) {
        return (
            <AppPageState
                title="This listing took a wrong turn."
                copy="It did not load properly just now. Head back home and try again in a moment."
            />
        );
    }
    if (!spot) {
        return (
            <AppPageState
                title="This parking spot slipped off the map."
                copy="It may have been removed or is no longer available to book."
            />
        );
    }

    const modeLabel = capitalizeLabel(spot.mode);
    const priceLabel =
        spot.mode === "free"
            ? "Free"
            : spot.mode === "auction"
                ? `Bid from ${formatGbp(auctionMinPerUnit)} / ${listingUnit}`
                : `${formatGbp(listingPrice)} / ${listingUnit}`;

    const estimatedBookingTotalLabel =
        spot.mode === "free"
            ? "Free"
            : payMethod === "points"
                ? pointsMinTotal > 0
                    ? `${pointsMinTotal} pts`
                    : "-"
                : formatGbp(estimatedTotal);

    return (
        <div className="container">
            <div className="spotSimple">
                <div className="spotSimpleHeaderStack">
                    <div className={`card spotSimpleHeader ${auctionClosed ? "spotSimpleHeader--closed" : ""}`}>
                        <div className="spotSimpleHeaderTop">
                            <div className="spotSimpleHeaderCopy">
                                <div className="heroKicker">ParkingBuddies</div>
                                <div className="heroTitle">{spot.title}</div>
                                <p className="muted spotSimpleHeaderDesc">{spot.description}</p>
                            </div>

                            <div className="spotHeaderThumb" aria-hidden="true">
                                {spot.image_url ? (
                                    <img src={spot.image_url} alt={spot.title} className="spotHeaderThumbImg" />
                                ) : (
                                    <div className="spotHeaderThumbFallback">No image</div>
                                )}
                            </div>
                        </div>

                        <div className="spotSimpleBadges">
                            <span className="badge">{modeLabel}</span>
                            <span className="badge badge--cool">{priceLabel}</span>
                            <span className="badge">{formatAvailability(spot)}</span>
                            {listingInactive && <span className="badge badge--rose">Inactive</span>}
                            {capacity > 1 && <span className="badge badge--green">{capacity}/{capacity} available</span>}
                            {auctionClosed && (
                                <span className="badge badge--rose">No slots left</span>
                            )}
                            {featureBadges.map((feature) => (
                                <span key={feature} className={`badge badge--${listingFeatureTone(feature)}`}>
                                    {listingFeatureLabel(feature)}
                                </span>
                            ))}
                        </div>
                    </div>

                    {isOwner && (
                        <div className="spotOwnerTools">
                            <div className="rowInline spotOwnerActions">
                                <Link to={`/create-listing?edit=${spot.id}`} className="btn btn-primary">
                                    Edit listing
                                </Link>
                            </div>
                        </div>
                    )}
                </div>

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
                </aside>

                <main className="spotSimpleMain">
                    <div className="card spotSimpleAction">
                        <div className="h3">Choose your slot</div>
                        <p className="tiny muted" style={{ margin: "0 0 6px" }}>
                            Tap a start date, then an end date, then choose the exact times.
                        </p>

                        <SlotCalendar
                            key={`${calendarStartDate || "none"}-${calendarEndDate || "none"}-${calendarResetNonce}`}
                            spot={spot}
                            bookings={bookings}
                            capacity={capacity}
                            startDate={calendarStartDate}
                            endDate={calendarEndDate}
                            onPickDate={pickCalendarDate}
                            disabled={busy || listingInactive}
                        />

                        <div className="slotRangeSummary">
                            <div className="slotRangeSummaryHead" style={{ justifyContent: "space-between", alignItems: "center" }}>
                                <span className="badge">{hasSelectedSlot ? "Ready to book" : "No slot selected yet"}</span>
                                <button
                                    type="button"
                                    className="btn"
                                    onClick={resetCalendarSelection}
                                    disabled={busy || listingInactive}
                                    style={{ padding: "6px 12px", fontSize: 12 }}
                                >
                                    Reset
                                </button>
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
                                </>
                            ) : null}
                        </div>

                        {slotStatus.label && (
                            <div className={`slotStatus ${slotStatus.ok ? "slotStatus--ok" : "slotStatus--bad"}`}>
                                {slotStatus.label}
                            </div>
                        )}
                    </div>

                    {spot.mode === "auction" ? (
                        <div className="card spotSimpleAction">
                            <div className="h3">Place a bid</div>

                            {!token && (
                                <div className="spotAlert spotAlert--danger">
                                    Please <Link to="/login">log in</Link> to bid.
                                </div>
                            )}
                            {listingInactive && <div className="spotAlert">This listing is no longer active for new bids.</div>}

                            <AppRadioCards
                                ariaLabel="Bid payment method"
                                className="payToggle"
                                itemClassName="payToggleBtn"
                                activeClassName="active"
                                orientation="horizontal"
                                value={bidPayMethod}
                                onChange={setBidPayMethod}
                                isDisabled={auctionClosed || listingInactive}
                                options={[
                                    ...(canUseMoneyBids ? [{ id: "money" as const, content: "Money" }] : []),
                                    ...(canUsePoints ? [{ id: "points" as const, content: "Points" }] : []),
                                ]}
                            />

                            {bidPayMethod === "money" ? (
                                <label style={{ display: "grid", gap: 6 }}>
                                    {auctionMoneyMinimumLabel ? (
                                        <div className="tiny muted" style={{ paddingLeft: "5px" }}>
                                            {auctionMoneyMinimumLabel}
                                        </div>
                                    ) : null}
                                    <input
                                        className="input"
                                        type="number"
                                        min={auctionRequiredMinPerUnit > 0 ? auctionRequiredMinPerUnit : 0.01}
                                        step={0.01}
                                        value={bidMoneyPerHour}
                                        onChange={(e) => setBidMoneyPerHour(e.target.value)}
                                        placeholder={`Your bid per ${listingUnit} (GBP)`}
                                        disabled={auctionClosed || listingInactive}
                                    />
                                </label>
                            ) : (
                                <label style={{ display: "grid", gap: 6 }}>
                                    <div className="tiny muted">
                                        Points bid
                                        {auctionPointsStartLabel && <span> · Minimum {auctionPointsStartPerUnit} pts / {listingUnit}</span>}
                                    </div>
                                    <input
                                        className="input"
                                        type="number"
                                        min={1}
                                        step={1}
                                        value={bidPointsPerHour}
                                        onChange={(e) => setBidPointsPerHour(e.target.value)}
                                        placeholder={`Points per ${listingUnit}`}
                                        disabled={auctionClosed || listingInactive}
                                    />
                                </label>
                            )}

                            <div className="spotSimpleInlineMeta spotEstimateBadgeRow">
                                <span className="badge spotEstimateBadge">
                                    <span className="spotEstimateBadgeLabel">Total price:</span>
                                    <strong>{bidPayMethod === "points" ? (bidTotalPoints > 0 ? `${bidTotalPoints} pts` : "-") : (bidTotalMoney > 0 ? formatGbp(bidTotalMoney) : "-")}</strong>
                                </span>
                            </div>

                            <div className="rowInline" style={{ marginTop: 4 }}>
                                <button
                                    onClick={goToBidConfirm}
                                    className="btn btn-primary"
                                    disabled={isOwner || auctionClosed || listingInactive}
                                >
                                    Review bid
                                </button>
                            </div>
                            {bidMsg && <div className="spotAlert spotAlert--danger">{bidMsg}</div>}
                            {isOwner && <div className="spotAlert">You are the owner of this listing.</div>}
                        </div>
                    ) : (
                        <div className="card spotSimpleAction">
                            <div className="h3">Book this space</div>

                            {!token && (
                                <div className="spotAlert spotAlert--danger">
                                    Please <Link to="/login">log in</Link> to book.
                                </div>
                            )}
                            {isOwner && <div className="spotAlert">You cannot book your own listing.</div>}
                            {listingInactive && <div className="spotAlert">This listing is no longer active for new bookings.</div>}

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

                            <div className="spotSimpleInlineMeta spotEstimateBadgeRow">
                                <span className="badge spotEstimateBadge">
                                    <span className="spotEstimateBadgeLabel">Total price:</span>
                                    <strong>{estimatedBookingTotalLabel}</strong>
                                </span>
                            </div>

                            <div className="rowInline" style={{ marginTop: 4 }}>
                                <button
                                    onClick={createBooking}
                                    className="btn btn-primary"
                                    disabled={isOwner || busy || listingInactive}
                                >
                                    {busy
                                        ? "Booking..."
                                        : payMethod === "points"
                                          ? "Review points booking"
                                          : isFreeBooking
                                            ? "Confirm free booking"
                                            : "Continue to payment"}
                                </button>
                            </div>
                            {actionMsg && <div className="spotAlert spotAlert--danger">{actionMsg}</div>}
                        </div>
                    )}
                </main>
            </div>

            <SlotDialog
                open={slotDialogOpen}
                spot={spot}
                bookings={bookings}
                capacity={capacity}
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
