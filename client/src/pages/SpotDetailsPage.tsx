import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, Link, useSearchParams, useNavigate } from "react-router-dom";
import { apiGet, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import SpotsMap from "../components/SpotsMap";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, CardElement, useElements, useStripe } from "@stripe/react-stripe-js";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string);

type ParkingSpot = {
    id: string;
    owner_user_id: string;
    title: string;
    description: string;
    address_text: string;
    lat: number;
    lng: number;
    price_gbp: any; // can come as string like "5.00"
    mode: string;
    allow_points?: boolean;
    points_cost?: number;
    image_url?: string | null;
    price_unit?: "hour" | "day" | "week";
    auction_end?: string | null;
    auction_start_price_gbp?: number | null;
    availability_json?: {
        type: "24_7" | "same_everyday" | "custom_weekly";
        start?: string;
        end?: string;
        rules?: Array<{ dow: number; start: string; end: string }>;
        date_from?: string;
        date_to?: string;
    } | null;
    availability_type?: "24_7" | "weekly";
    available_days?: number[];
    daily_start?: string | null;
    daily_end?: string | null;
};

type Booking = {
    id: string;
    status: string;
    pay_method: "money" | "points";
    total_price_gbp: any;
    total_points: number | null;
    start_time?: string;
    end_time?: string;
};

type SlotOption = {
    start: Date;
    minutes: number;
};

function BidCardForm({
    clientSecret,
    onAuthorized,
    busy,
}: {
    clientSecret: string;
    onAuthorized: () => void;
    busy?: boolean;
}) {
    const stripe = useStripe();
    const elements = useElements();
    const [status, setStatus] = useState<string | null>(null);
    const [localBusy, setLocalBusy] = useState(false);

    async function confirm() {
        if (!stripe || !elements) return;
        setLocalBusy(true);
        setStatus(null);
        const card = elements.getElement(CardElement);
        if (!card) {
            setStatus("Card input not ready");
            setLocalBusy(false);
            return;
        }
        const result = await stripe.confirmCardPayment(clientSecret, {
            payment_method: { card },
        });
        if (result.error) {
            setStatus(result.error.message ?? "Card authorization failed");
            setLocalBusy(false);
            return;
        }
        setStatus("Card authorized ✅");
        onAuthorized();
        setLocalBusy(false);
    }

    return (
        <div className="card spotBookingCard">
            <div className="tiny muted">Card details (authorization only)</div>
            <div style={{ padding: 10, border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, marginTop: 8 }}>
                <CardElement options={{ hidePostalCode: true }} />
            </div>
            <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={confirm} disabled={busy || localBusy || !stripe}>
                {busy || localBusy ? "Authorizing…" : "Authorize bid"}
            </button>
            {status && <div className="tiny" style={{ marginTop: 8 }}>{status}</div>}
        </div>
    );
}

export default function SpotDetailsPage() {
    const { id } = useParams<{ id: string }>();
    const [searchParams] = useSearchParams();
    const { token, user } = useAuth();
    const navigate = useNavigate();

    const [spot, setSpot] = useState<ParkingSpot | null>(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);

    const [startDate, setStartDate] = useState(() => localDateStr(nextWholeHour()));
    const [startTime, setStartTime] = useState(() => localTimeStr(nextWholeHour()));
    const [durationMinutes, setDurationMinutes] = useState(60);
    const [payMethod, setPayMethod] = useState<"money" | "points">("money");
    const [pointsAmount, setPointsAmount] = useState("");

    const [actionMsg, setActionMsg] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [spotBookings, setSpotBookings] = useState<Booking[]>([]);

    const [clientSecret, setClientSecret] = useState<string | null>(null);
    const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);

    const [bidAmount, setBidAmount] = useState("");
    const [bidPayMethod, setBidPayMethod] = useState<"money" | "points">("money");
    const [bidPointsAmount, setBidPointsAmount] = useState("");
    const [bidMsg, setBidMsg] = useState<string | null>(null);
    const [bidBusy, setBidBusy] = useState(false);
    const [nextSlotOptions, setNextSlotOptions] = useState<SlotOption[]>([]);
    const [nowMs, setNowMs] = useState(() => Date.now());
    const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(new Date()));
    const [auctionInfo, setAuctionInfo] = useState<{
        highest_pending_bid_gbp: number;
        auction_end?: string | null;
        auction_start_price_gbp?: number | null;
        pending_bids?: Array<{
            id: string;
            amount_gbp: number;
            amount_points?: number;
            pay_method?: "money" | "points";
            status: string;
            start_time?: string;
            end_time?: string;
            bidder_name?: string;
            bidder_email?: string;
        }>;
        approved_bids?: Array<{
            id: string;
            amount_gbp: number;
            amount_points?: number;
            pay_method?: "money" | "points";
            status: string;
            start_time?: string;
            end_time?: string;
            created_at?: string;
        }>;
        sold_out?: boolean;
    } | null>(null);
    const [auctionMyBids, setAuctionMyBids] = useState<
        Array<{
            id?: string;
            status?: string;
            amount_gbp?: number;
            amount_points?: number;
            pay_method?: "money" | "points";
            start_time?: string;
            end_time?: string;
            created_at?: string;
        }>
    >([]);

    const allowPoints = !!spot?.allow_points && !!spot?.points_cost;
    const showPoints = allowPoints;
    const canUsePoints = showPoints;

    useEffect(() => {
        if (!id) return;
        setLoading(true);
        setErr(null);

        apiGet<{ parking_spot: ParkingSpot }>(`/parking-spots/${id}`)
            .then((data) => setSpot(data.parking_spot))
            .catch((e) => setErr(e.message || "Failed to load spot"))
            .finally(() => setLoading(false));
    }, [id]);

    useEffect(() => {
        const date = searchParams.get("date");
        const time = searchParams.get("time");
        const duration = searchParams.get("duration");
        if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
            setStartDate(date);
        }
        if (time && /^\d{2}:\d{2}$/.test(time)) {
            setStartTime(time);
        }
        if (duration) {
            const minutes = Number(duration);
            if (Number.isFinite(minutes) && minutes > 0) {
                setDurationMinutes(minutes);
            }
        }
    }, [searchParams]);

    const refreshSpotBookings = useCallback(async (spotId: string) => {
        try {
            const r = await apiGet<{ bookings: Booking[] }>(`/bookings/spot/${spotId}`);
            setSpotBookings(r.bookings ?? []);
        } catch {
            setSpotBookings([]);
        }
    }, []);

    useEffect(() => {
        if (!id) return;
        void refreshSpotBookings(id);
    }, [id, refreshSpotBookings]);

    async function refreshAuction() {
        if (!spot || spot.mode !== "auction") return;
        try {
            if (token) {
                const r = await apiGet<{ auction: any }>(`/auctions/${spot.id}`, token);
                setAuctionInfo(r.auction);
            } else {
                const r = await apiGet<{ auction: any }>(`/auctions/${spot.id}`);
                setAuctionInfo(r.auction);
            }
            if (token) {
                const meR = await apiGet<{ me: any; bids?: any[] }>(`/auctions/${spot.id}/me`, token);
                const allMyBids = Array.isArray(meR.bids) ? meR.bids : meR.me ? [meR.me] : [];
                setAuctionMyBids(allMyBids);
            } else {
                setAuctionMyBids([]);
            }
        } catch (e: any) {
            setBidMsg(e.message || "Failed to load auction details");
        }
    }

    useEffect(() => {
        if (!spot || spot.mode !== "auction") return;
        refreshAuction();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [spot, token, user]);

    useEffect(() => {
        setClientSecret(null);
        setPaymentIntentId(null);
    }, [bidAmount, spot?.id]);

    useEffect(() => {
        setClientSecret(null);
        setPaymentIntentId(null);
    }, [bidPayMethod]);

    useEffect(() => {
        setNextSlotOptions([]);
    }, [spot?.id]);

    useEffect(() => {
        const id = setInterval(() => setNowMs(Date.now()), 1000);
        return () => clearInterval(id);
    }, []);

    useEffect(() => {
        if (bidPayMethod !== "points") return;
        const min = Number(spot?.points_cost ?? 0);
        if (!Number.isFinite(min) || min <= 0) return;
        const current = Number(bidPointsAmount);
        if (!Number.isFinite(current) || current < min) {
            setBidPointsAmount(String(min));
        }
    }, [bidPayMethod, bidPointsAmount, spot?.points_cost]);

    useEffect(() => {
        if (!canUsePoints && payMethod === "points") {
            setPayMethod("money");
        }
    }, [canUsePoints, payMethod]);

    useEffect(() => {
        if (!allowPoints && bidPayMethod === "points") {
            setBidPayMethod("money");
        }
    }, [allowPoints, bidPayMethod]);

    useEffect(() => {
        if (!spot || spot.mode !== "auction") return;
        const max = getMaxDurationMinutes(spot, startDate, startTime);
        const options = getDurationOptions(max);
        if (!options.length) return;
        const last = options[options.length - 1]?.minutes ?? durationMinutes;
        if (durationMinutes > last) {
            setDurationMinutes(last);
        }
    }, [spot, startDate, startTime, durationMinutes]);

    useEffect(() => {
        if (!spot || spot.mode !== "auction") return;
        const id = setInterval(() => {
            refreshAuction();
        }, 8000);
        return () => clearInterval(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [spot?.id, spot?.mode, token]);

    useEffect(() => {
        const parsed = parseYmd(startDate);
        if (!parsed) return;
        setCalendarMonth(startOfMonth(parsed));
    }, [startDate]);


    const price = useMemo(() => Number(spot?.price_gbp ?? 0), [spot]);
    const auctionStart = Number(spot?.auction_start_price_gbp ?? 0);
    const auctionPriceLabel = `Min bid £${auctionStart.toFixed(2)}`;
    const priceLabel =
        spot?.mode === "auction"
            ? auctionPriceLabel
            : price > 0
                ? `£${price.toFixed(2)}`
                : "Free";
    const unit = (spot?.price_unit ?? "hour") as "hour" | "day" | "week";
    const latestMyBid = auctionMyBids[0] ?? null;
    const auctionBidPrice = Number(latestMyBid?.amount_gbp ?? 0);
    const effectiveUnit = spot?.mode === "auction" ? "hour" : unit;
    const effectivePrice = spot?.mode === "auction" && auctionBidPrice > 0 ? auctionBidPrice : price;

    const canBook = !!token;
    const isOwner = !!user && !!spot && user.id === spot.owner_user_id;
    const auctionSoldOut = Boolean(auctionInfo?.sold_out);
    const nextWindow = useMemo(() => (spot ? getNextAvailableWindow(spot, spotBookings) : null), [spot, spotBookings]);

    function estimateTotal(startIso: string, endIso: string) {
        if (!spot) return 0;
        const s = new Date(startIso);
        const e = new Date(endIso);
        if (!(s < e)) return 0;
        const ms = e.getTime() - s.getTime();
        const minutes = ms / (1000 * 60);
        let units = 1;
        if (effectiveUnit === "hour") {
            const roundedMinutes = Math.max(5, Math.ceil(minutes / 5) * 5);
            units = roundedMinutes / 60;
        }
        if (effectiveUnit === "day") units = Math.max(1, Math.ceil(minutes / (60 * 24)));
        if (effectiveUnit === "week") units = Math.max(1, Math.ceil(minutes / (60 * 24 * 7)));
        return Math.max(0, effectivePrice * units);
    }

    const start = useMemo(() => `${startDate}T${startTime}`, [startDate, startTime]);
    const endDateTime = useMemo(() => addMinutes(new Date(start), durationMinutes), [start, durationMinutes]);
    const end = useMemo(() => `${localDateStr(endDateTime)}T${localTimeStr(endDateTime)}`, [endDateTime]);
    const estimatedTotal = useMemo(() => estimateTotal(start, end), [start, end, effectivePrice, effectiveUnit]);
    const pointsMin = useMemo(() => {
        if (!spot || !spot.points_cost) return 0;
        const units = calcUnitsForMinutes(durationMinutes, effectiveUnit);
        return Math.ceil(Number(spot.points_cost) * units);
    }, [spot, durationMinutes, effectiveUnit]);
    const bidTotalPoints = useMemo(() => {
        if (bidPayMethod !== "points") return 0;
        const pts = Number(bidPointsAmount);
        if (!Number.isFinite(pts) || pts <= 0) return 0;
        const bidStart = new Date(`${startDate}T${startTime}`);
        const bidEnd = addMinutes(bidStart, durationMinutes);
        if (Number.isNaN(bidStart.getTime()) || Number.isNaN(bidEnd.getTime()) || !(bidStart < bidEnd)) return 0;
        const minutes = Math.round((bidEnd.getTime() - bidStart.getTime()) / 60000);
        const units = calcUnitsForMinutes(minutes, "hour");
        return Math.ceil(pts * units);
    }, [bidPayMethod, bidPointsAmount, startDate, startTime, durationMinutes]);
    const bidUnits = useMemo(() => {
        const bidStart = new Date(`${startDate}T${startTime}`);
        const bidEnd = addMinutes(bidStart, durationMinutes);
        if (Number.isNaN(bidStart.getTime()) || Number.isNaN(bidEnd.getTime()) || !(bidStart < bidEnd)) return 0;
        const minutes = Math.round((bidEnd.getTime() - bidStart.getTime()) / 60000);
        return calcUnitsForMinutes(minutes, "hour");
    }, [startDate, startTime, durationMinutes]);
    const bidTotalMoney = useMemo(() => {
        const perHour = Number(bidAmount);
        if (!Number.isFinite(perHour) || perHour <= 0) return 0;
        if (!Number.isFinite(bidUnits) || bidUnits <= 0) return 0;
        return Math.round(perHour * bidUnits * 100) / 100;
    }, [bidAmount, bidUnits]);
    const minBidPerHour = useMemo(() => {
        const v = Number(spot?.auction_start_price_gbp ?? 0);
        return Number.isFinite(v) ? v : 0;
    }, [spot?.auction_start_price_gbp]);
    const bidMinTotalPoints = useMemo(() => {
        if (!spot?.points_cost) return 0;
        const bidStart = new Date(`${startDate}T${startTime}`);
        const bidEnd = addMinutes(bidStart, durationMinutes);
        if (Number.isNaN(bidStart.getTime()) || Number.isNaN(bidEnd.getTime()) || !(bidStart < bidEnd)) return 0;
        const minutes = Math.round((bidEnd.getTime() - bidStart.getTime()) / 60000);
        const units = calcUnitsForMinutes(minutes, "hour");
        return Math.ceil(Number(spot.points_cost) * units);
    }, [spot?.points_cost, startDate, startTime, durationMinutes]);
    const userPoints = Number(user?.points_balance ?? 0);
    const bidPointsInsufficient = bidPayMethod === "points" && bidTotalPoints > 0 && userPoints < bidTotalPoints;
    const auctionEndMs = useMemo(() => {
        if (!spot?.auction_end) return null;
        const t = new Date(spot.auction_end).getTime();
        return Number.isFinite(t) ? t : null;
    }, [spot?.auction_end]);
    const auctionTimeLeftMs = useMemo(() => {
        if (!auctionEndMs) return null;
        return auctionEndMs - nowMs;
    }, [auctionEndMs, nowMs]);
    const auctionEnded = auctionTimeLeftMs != null && auctionTimeLeftMs <= 0;
    const auctionClosed = spot?.mode === "auction" && (auctionEnded || auctionSoldOut);
    const auctionClosedHeadline = auctionSoldOut
        ? "Auction sold out - this listing is no longer accepting bids."
        : "Auction ended - this listing is no longer accepting bids.";
    const auctionTimeLeftLabel = useMemo(() => {
        if (auctionTimeLeftMs == null) return null;
        return auctionTimeLeftMs <= 0 ? "Auction ended" : formatCountdown(auctionTimeLeftMs);
    }, [auctionTimeLeftMs]);
    useEffect(() => {
        if (payMethod !== "points") return;
        if (pointsMin <= 0) return;
        const current = Number(pointsAmount);
        if (!Number.isFinite(current) || current < pointsMin) {
            setPointsAmount(String(pointsMin));
        }
    }, [payMethod, pointsMin, pointsAmount]);
    const conflicts = useMemo(() => {
        const s = new Date(start);
        const e = new Date(end);
        return spotBookings.filter((b) => {
            if (!b.start_time || !b.end_time) return false;
            const bs = new Date(b.start_time);
            const be = new Date(b.end_time);
            return bs < e && be > s;
        });
    }, [spotBookings, start, end]);
    const capacity = Math.max(1, Number((spot as any)?.capacity_total ?? 1));
    const spotsRemaining = Math.max(0, capacity - conflicts.length);
    const fullyBooked = spotsRemaining <= 0;
    const availabilitySegments = useMemo(
        () => (spot ? getAvailabilitySegments(spot, spotBookings, 45) : []),
        [spot, spotBookings]
    );
    const nearestLongestSlots = useMemo(
        () => getNearestLongestSlotsFromSegments(availabilitySegments, 4),
        [availabilitySegments]
    );
    const longestSlotsByDate = useMemo(
        () => buildLongestSlotsByDate(availabilitySegments),
        [availabilitySegments]
    );
    const hasAvailabilityRules = useMemo(
        () => !!spot && extractAvailabilityRules(spot).length > 0,
        [spot]
    );
    const selectedDateSlot = longestSlotsByDate[startDate] ?? null;
    const slotAllowed = useMemo(() => {
        if (!spot) return true;
        const s = new Date(start);
        const e = new Date(end);
        if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return false;
        return isSlotAllowed(spot, s, e);
    }, [spot, start, end]);
    const slotStatus = hasAvailabilityRules && !selectedDateSlot
        ? { ok: false, label: "Selected date has no available time left. Choose a green date." }
        : !slotAllowed
            ? { ok: false, label: "Requested slot is outside listing availability." }
            : fullyBooked
                ? { ok: false, label: capacity > 1 ? "All spots are booked for this slot." : "Slot is currently booked." }
                : {
                    ok: true,
                    label: capacity > 1
                        ? `${spotsRemaining} spot${spotsRemaining === 1 ? "" : "s"} left for this slot.`
                        : "Slot is available.",
                };
    const calendarDays = useMemo(() => buildCalendarGrid(calendarMonth), [calendarMonth]);

    function toIso(date: string, time: string) {
        return new Date(`${date}T${time}`).toISOString();
    }

    function publishSlotMessage(message: string) {
        setActionMsg(message);
        setBidMsg(message);
    }

    function setSlot(d: Date, minutes: number, msg?: string) {
        const startD = new Date(d);
        const safeMinutes = Math.max(15, Math.floor(minutes / 15) * 15);
        setStartDate(localDateStr(startD));
        setStartTime(localTimeStr(startD));
        setDurationMinutes(safeMinutes);
        const endD = addMinutes(startD, safeMinutes);
        publishSlotMessage(msg ?? `Slot set: ${formatLocalDateTime(startD)} → ${formatLocalDateTime(endD)}.`);
    }

    function applyNearestLongestSlot(msg?: string) {
        if (!nearestLongestSlots.length) {
            publishSlotMessage("No available slot found. Try another date.");
            setNextSlotOptions([]);
            return false;
        }
        const primary = nearestLongestSlots[0];
        setSlot(primary.start, primary.minutes, msg ?? "Next available slot applied.");
        setNextSlotOptions(nearestLongestSlots);
        return true;
    }

    function handleDateChange(nextDate: string) {
        setStartDate(nextDate);
        const parsedDate = parseYmd(nextDate);
        if (parsedDate) {
            setCalendarMonth(startOfMonth(parsedDate));
        }
        const dayOptions = getSlotsForDateFromSegments(availabilitySegments, nextDate, 4);
        if (!dayOptions.length) {
            publishSlotMessage("Selected date has no availability left. Pick a green date.");
            setNextSlotOptions([]);
            return;
        }
        setSlot(dayOptions[0].start, dayOptions[0].minutes, "Longest available slot for the selected day applied.");
        setNextSlotOptions(dayOptions);
    }

    function handleCalendarDayPick(day: Date) {
        const dayKey = localDateStr(day);
        setCalendarMonth(startOfMonth(day));
        handleDateChange(dayKey);
    }

    const findNextSlots = () => {
        if (!spot) return;
        const slots = getNextSlots(spot, spotBookings, durationMinutes, 3);
        if (!slots.length) {
            publishSlotMessage("No available slot found. Try another time or duration.");
            return;
        }
        const options = slots.map((slotStart) => ({ start: slotStart, minutes: durationMinutes }));
        setSlot(options[0].start, options[0].minutes, "Next available slot applied.");
        setNextSlotOptions(options);
    };

    const findNextAvailableSlots = () => {
        if (!spot) return;
        applyNearestLongestSlot("Next available slot applied.");
    };

    async function createBooking() {
        if (!token) {
            setActionMsg("You must be logged in to book.");
            return;
        }
        if (!spot) return;
        if (!slotStatus.ok) {
            setActionMsg(slotStatus.label);
            return;
        }
        if (payMethod === "points") {
            const pts = Number(pointsAmount);
            if (!Number.isFinite(pts) || pts <= 0) {
                setActionMsg("Enter a valid points amount.");
                return;
            }
            if (pointsMin > 0 && pts < pointsMin) {
                setActionMsg(`Minimum for this slot is ${pointsMin} pts.`);
                return;
            }
        }

        const startIso = toIso(startDate, startTime);
        const endIso = toIso(localDateStr(endDateTime), localTimeStr(endDateTime));
        const startMs = new Date(startIso).getTime();
        const endMs = new Date(endIso).getTime();
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
            setActionMsg("Please choose a valid booking time range.");
            return;
        }
        setBusy(true);
        setActionMsg(null);
        try {
            const body: any = {
                parking_spot_id: spot.id,
                start_time: startIso,
                end_time: endIso,
                pay_method: payMethod,
            };
            if (payMethod === "points") {
                body.points_amount = Math.ceil(Number(pointsAmount || 0));
            }

            const r = await apiPost<{ booking: Booking }>("/bookings", body, token);
            const created = r.booking;
            await refreshSpotBookings(spot.id);

            const needsMoneyPayment =
                created?.pay_method === "money" &&
                Number(created?.total_price_gbp ?? 0) > 0 &&
                created?.status === "pending";

            if (needsMoneyPayment && created?.id) {
                navigate(`/pay/${created.id}`);
                return;
            }

            setActionMsg("Booking confirmed.");
            navigate("/dashboard?tab=myBookings");
        } catch (e: any) {
            setActionMsg(e?.message || "Booking failed.");
        } finally {
            setBusy(false);
        }
    }

    async function startBidAuthorization() {
        if (!token) {
            setBidMsg("You must be logged in to place a bid.");
            return;
        }
        if (!spot) return;
        if (bidPayMethod === "points") return;
        if (!slotStatus.ok) {
            setBidMsg(slotStatus.label);
            return;
        }

        const perHour = Number(bidAmount);
        if (!Number.isFinite(perHour) || perHour <= 0) {
            setBidMsg("Enter a valid bid amount per hour.");
            return;
        }
        if (!Number.isFinite(bidUnits) || bidUnits <= 0) {
            setBidMsg("Choose a valid time slot.");
            return;
        }
        const amount = Math.round(perHour * bidUnits * 100) / 100;

        setBidBusy(true);
        setBidMsg(null);
        try {
            const res = await apiPost<{ client_secret: string; payment_intent_id: string }>(
                "/payments/auction-intent",
                { spot_id: spot.id, amount_gbp: amount },
                token
            );
            setClientSecret(res.client_secret);
            setPaymentIntentId(res.payment_intent_id);
            setBidMsg("Card authorization required to place the bid.");
        } catch (e: any) {
            setBidMsg(e.message || "Bid authorization failed");
        } finally {
            setBidBusy(false);
        }
    }

    function goToBidConfirm() {
        if (!spot) return;
        if (!slotStatus.ok) {
            setBidMsg(slotStatus.label);
            return;
        }
        const bidStart = new Date(`${startDate}T${startTime}`);
        const bidEnd = addMinutes(bidStart, durationMinutes);
        if (Number.isNaN(bidStart.getTime()) || Number.isNaN(bidEnd.getTime()) || !(bidStart < bidEnd)) {
            setBidMsg("Choose a valid time slot.");
            return;
        }
        if (bidPayMethod === "money") {
            const perHour = Number(bidAmount);
            if (!Number.isFinite(perHour) || perHour <= 0) {
                setBidMsg("Enter a valid bid amount per hour.");
                return;
            }
            if (minBidPerHour > 0 && perHour < minBidPerHour) {
                setBidMsg(`Minimum bid per hour is £${minBidPerHour.toFixed(2)}.`);
                return;
            }
        }
        const params = new URLSearchParams({
            spotId: spot.id,
            start: bidStart.toISOString(),
            end: bidEnd.toISOString(),
            pay: bidPayMethod,
            perHour: bidPayMethod === "money" ? String(bidAmount || "") : "",
            pointsPerHour: bidPayMethod === "points" ? String(bidPointsAmount || "") : "",
        });
        navigate(`/bids/confirm?${params.toString()}`);
    }

    async function placeBid() {
        if (!token || !spot) return;
        if (auctionSoldOut) {
            setBidMsg("This auction is sold out.");
            return;
        }
        if (!slotStatus.ok) {
            setBidMsg(slotStatus.label);
            return;
        }
        const perHour = Number(bidAmount);
        if (bidPayMethod === "money") {
            if (!Number.isFinite(perHour) || perHour <= 0) {
                setBidMsg("Enter a valid bid amount per hour.");
                return;
            }
            if (!Number.isFinite(bidUnits) || bidUnits <= 0) {
                setBidMsg("Choose a valid time slot.");
                return;
            }
            if (!paymentIntentId) {
                setBidMsg("Missing payment authorization. Please try again.");
                return;
            }
        } else {
            const pts = Number(bidPointsAmount);
            if (!Number.isFinite(pts) || pts <= 0) {
                setBidMsg("Enter a valid points bid.");
                return;
            }
            if (bidPointsInsufficient) {
                setBidMsg(`You need ${bidTotalPoints} pts to place this bid (you have ${userPoints} pts).`);
                return;
            }
        }
        const bidStart = new Date(`${startDate}T${startTime}`);
        const bidEnd = addMinutes(bidStart, durationMinutes);
        if (Number.isNaN(bidStart.getTime()) || Number.isNaN(bidEnd.getTime()) || !(bidStart < bidEnd)) {
            setBidMsg("Choose a valid time slot.");
            return;
        }
        setBidBusy(true);
        setBidMsg(null);
        try {
            if (bidPayMethod === "money") {
                const amount = Math.round(perHour * bidUnits * 100) / 100;
                const res = await apiPost<{ auction: any; bid_id?: string }>(
                    `/auctions/${spot.id}/bid`,
                    {
                        amount_gbp: amount,
                        payment_intent_id: paymentIntentId,
                        start_time: bidStart.toISOString(),
                        end_time: bidEnd.toISOString(),
                        pay_method: "money",
                    },
                    token
                );
                if (res?.bid_id) {
                    navigate(`/bids/${res.bid_id}`);
                }
            } else {
                const pts = Number(bidPointsAmount);
                const res = await apiPost<{ auction: any; bid_id?: string }>(
                    `/auctions/${spot.id}/bid`,
                    {
                        amount_points: pts,
                        start_time: bidStart.toISOString(),
                        end_time: bidEnd.toISOString(),
                        pay_method: "points",
                    },
                    token
                );
                if (res?.bid_id) {
                    navigate(`/bids/${res.bid_id}`);
                }
            }
            setBidMsg("Bid placed. Awaiting owner approval.");
            setClientSecret(null);
            setPaymentIntentId(null);
            setBidAmount("");
            setBidPointsAmount("");
            await refreshAuction();
        } catch (e: any) {
            setBidMsg(e.message || "Bid failed");
        } finally {
            setBidBusy(false);
        }
    }

    async function acceptBid(bidId: string) {
        if (!token || !spot) return;
        setBidBusy(true);
        setBidMsg(null);
        try {
            await apiPost<{ auction: any }>(`/auctions/${spot.id}/accept`, { bid_id: bidId }, token);
            await refreshAuction();
            setBidMsg("Bid accepted.");
        } catch (e: any) {
            setBidMsg(e.message || "Accept failed");
        } finally {
            setBidBusy(false);
        }
    }

    if (loading) return <div style={{ padding: 24 }}>Loading...</div>;
    if (err) return <div style={{ padding: 24, color: "red" }}>{err}</div>;
    if (!spot) return <div style={{ padding: 24 }}>Not found</div>;

    const pill =
        spot.mode === "free" ? "Free"
            : spot.mode === "rent" ? `£${price.toFixed(2)}` : auctionPriceLabel;

    const availabilityLabel = formatAvailability(spot);

    const approvedBids = auctionInfo?.approved_bids ?? [];
    const pendingBids = auctionInfo?.pending_bids ?? [];

    const myBidStatusCards = auctionMyBids.length > 0 ? (
        <div className="stack">
            {auctionMyBids.map((bid, idx) => {
                const status = bid.status ?? "";
                const statusLabel =
                    status === "pending"
                        ? "Pending — awaiting owner approval"
                        : status === "accepted"
                            ? "Accepted — booking confirmed"
                            : status === "won"
                                ? "Won — awaiting owner approval"
                                : status === "declined" || status === "rejected"
                                    ? "Declined"
                                    : status;
                const statusClass =
                    status === "accepted" || status === "won"
                        ? "spotBookingCard--ok"
                        : status === "pending"
                            ? "spotBookingCard--pending"
                            : status === "declined" || status === "rejected"
                                ? "spotBookingCard--bad"
                                : "spotBookingCard--neutral";

                return (
                    <Link
                        key={bid.id ?? `${bid.created_at ?? "bid"}-${idx}`}
                        to="/dashboard?tab=myAuctionBids"
                        className={`card spotBookingCard spotBookingCard--link ${statusClass}`}
                    >
                        <div className="tiny muted">Your bid #{auctionMyBids.length - idx}</div>
                        <div>{statusLabel}</div>
                        <div className="tiny muted" style={{ marginTop: 6, textDecoration: "underline" }}>
                            View in dashboard
                        </div>
                        {bid.pay_method === "points" || bid.amount_points != null ? (
                            <div className="tiny muted" style={{ marginTop: 6 }}>
                                {Number(bid.amount_points ?? 0)} pts
                            </div>
                        ) : bid.amount_gbp != null ? (
                            <div className="tiny muted" style={{ marginTop: 6 }}>
                                £{Number(bid.amount_gbp).toFixed(2)}
                            </div>
                        ) : null}
                        {bid.start_time && bid.end_time && (
                            <div className="tiny muted" style={{ marginTop: 6 }}>
                                {formatBidWindow(bid.start_time, bid.end_time)}
                            </div>
                        )}
                    </Link>
                );
            })}
        </div>
    ) : null;

    const bidsFooterSection = spot.mode === "auction" ? (
        <div className="card spotBook" style={{ marginTop: 14 }}>
            <div className="spotBookHeader">
                <div className="h3">Other bids</div>
                <div className="muted tiny">Latest activity for this auction.</div>
            </div>

            {approvedBids.length > 0 && (
                <div className="stack">
                    <div className="tiny muted">Recent approved bids</div>
                    {approvedBids.map((b) => (
                        <div key={b.id} className="card spotBookingCard">
                            <div className="rowInline">
                                <span className="badge badge--green">
                                    {b.pay_method === "points" || b.amount_points != null
                                        ? `${Number(b.amount_points ?? 0)} pts`
                                        : `£${Number(b.amount_gbp).toFixed(2)}`}
                                </span>
                                <span className="badge">Approved</span>
                            </div>
                            <div className="tiny muted" style={{ marginTop: 6 }}>
                                {formatBidWindow(b.start_time, b.end_time)}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {isOwner && pendingBids.length ? (
                <div className="stack">
                    <div className="tiny muted">Incoming bids</div>
                    {pendingBids.map((b) => (
                        <div key={b.id} className="card spotBookingCard">
                            <div className="rowInline">
                                <span className="badge">
                                    {b.pay_method === "points" || b.amount_points != null
                                        ? `${Number(b.amount_points ?? 0)} pts`
                                        : `£${Number(b.amount_gbp).toFixed(2)}`}
                                </span>
                                <span className="badge">{b.status}</span>
                            </div>
                            <div className="tiny muted" style={{ marginTop: 6 }}>
                                {b.bidder_name ?? b.bidder_email ?? "Bidder"}
                            </div>
                            <div className="tiny muted" style={{ marginTop: 6 }}>
                                {formatBidWindow(b.start_time, b.end_time)}
                            </div>
                            <div className="rowInline" style={{ marginTop: 10 }}>
                                <button
                                    onClick={() => acceptBid(b.id)}
                                    disabled={bidBusy}
                                    className="btn btn-primary"
                                >
                                    Accept
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            ) : pendingBids.length > 0 ? (
                <div className="stack">
                    <div className="tiny muted">Current bids</div>
                    {pendingBids.slice(0, 5).map((b) => (
                        <div key={b.id} className="card spotBookingCard">
                            <div className="rowInline">
                                <span className="badge">
                                    {b.pay_method === "points" || b.amount_points != null
                                        ? `${Number(b.amount_points ?? 0)} pts`
                                        : `£${Number(b.amount_gbp).toFixed(2)}`}
                                </span>
                                <span className="badge">{b.status}</span>
                            </div>
                            <div className="tiny muted" style={{ marginTop: 6 }}>
                                {formatBidWindow(b.start_time, b.end_time)}
                            </div>
                        </div>
                    ))}
                </div>
            ) : null}

            {approvedBids.length === 0 && pendingBids.length === 0 && (
                <div className="muted tiny">No bids yet.</div>
            )}
        </div>
    ) : null;

    const myBidsFooterSection = spot.mode === "auction" && myBidStatusCards ? (
        <div className="card spotBook" style={{ marginTop: 14 }}>
            <div className="spotBookHeader">
                <div className="h3">Your bids</div>
                <div className="muted tiny">Your latest activity on this listing.</div>
            </div>
            {myBidStatusCards}
        </div>
    ) : null;
    const calendarInteractionDisabled = busy || bidBusy;
    const availabilityCalendar = (
        <div className="availabilityCalendar card spotBookingCard">
            <div className="calendarHero">
                <div>
                    <div className="calendarKicker">Spot availability</div>
                    <div className="calendarTitle">{formatCalendarMonth(calendarMonth)}</div>
                    <div className="calendarSubtitle">Green dates are available, red dates are unavailable.</div>
                </div>
                <div className="calendarNav">
                    <button
                        type="button"
                        className="btn"
                        onClick={() => setCalendarMonth(addMonths(calendarMonth, -1))}
                        disabled={calendarInteractionDisabled}
                    >
                        ← Prev
                    </button>
                    <button
                        type="button"
                        className="btn"
                        onClick={() => setCalendarMonth(addMonths(calendarMonth, 1))}
                        disabled={calendarInteractionDisabled}
                    >
                        Next →
                    </button>
                </div>
            </div>
            <div className="calendarGrid calendarGrid--weekdays">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((weekday) => (
                    <div key={weekday} className="calendarWeekday">{weekday}</div>
                ))}
            </div>
            <div className="calendarGrid calendarGrid--days">
                {calendarDays.map((day) => {
                    const dayKey = localDateStr(day);
                    const slot = longestSlotsByDate[dayKey] ?? null;
                    const available = !!slot;
                    const inMonth = day.getMonth() === calendarMonth.getMonth() && day.getFullYear() === calendarMonth.getFullYear();
                    const selected = dayKey === startDate;
                    return (
                        <button
                            key={dayKey}
                            type="button"
                            className={`calendarDay ${available ? "calendarDay--available" : "calendarDay--unavailable"} ${selected ? "calendarDay--selected" : ""} ${inMonth ? "" : "calendarDay--otherMonth"}`}
                            onClick={() => handleCalendarDayPick(day)}
                            disabled={calendarInteractionDisabled}
                        >
                            <span className="calendarDayNum">{day.getDate()}</span>
                            <span className="calendarDayMeta">{available ? formatCompactDuration(slot.minutes) : "No slot"}</span>
                        </button>
                    );
                })}
            </div>
            <div className="calendarLegend">
                <span className="calendarLegendChip calendarLegendChip--available">Available</span>
                <span className="calendarLegendChip calendarLegendChip--unavailable">Unavailable</span>
                <span className="tiny muted">Tap any day to apply the best slot for that date.</span>
            </div>
        </div>
    );

    const bookingPanel = (
        <div className="card spotBook">
            <div className="spotBookHeader">
                <div className="h3">Reserve this space</div>
                <div className="muted tiny">Pick a start time and duration. We’ll calculate the end time for you.</div>
            </div>

            {!canBook && (
                <div className="spotAlert">
                    Please <Link to="/login">log in</Link> to book.
                </div>
            )}

            {isOwner && (
                <div className="spotAlert">
                    You can’t book your own spot.
                </div>
            )}

            <div className="rowInline">
                <button
                    type="button"
                    className="btn"
                    onClick={findNextSlots}
                    disabled={!canBook || isOwner || busy}
                >
                    Find next available slot
                </button>
            </div>
            {nextSlotOptions.length > 1 && (
                <div className="rowInline" style={{ marginTop: 6, flexWrap: "wrap" }}>
                    {nextSlotOptions.slice(1).map((slot, i) => (
                        <button
                            key={`${slot.start.toISOString()}-${slot.minutes}-${i}`}
                            type="button"
                            className="btn"
                            onClick={() => setSlot(slot.start, slot.minutes, "Alternate slot applied.")}
                            disabled={!canBook || isOwner || busy}
                        >
                            {formatSlotLabel(slot.start, slot.minutes)}
                        </button>
                    ))}
                </div>
            )}

            <div className="row">
                <label>
                    <span>Start date</span>
                    <input
                        className="input"
                        type="date"
                        value={startDate}
                        onChange={(e) => handleDateChange(e.target.value)}
                        disabled={!canBook || isOwner || busy}
                    />
                </label>

                <label>
                    <span>Start time</span>
                    <input
                        className="input"
                        type="time"
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                        disabled={!canBook || isOwner || busy}
                    />
                </label>
            </div>
            {availabilityCalendar}

            <label>
                <span>Duration (hours)</span>
                <input
                    className="input"
                    type="number"
                    min={0.25}
                    step={0.25}
                    value={Number((durationMinutes / 60).toFixed(2))}
                    onChange={(e) => {
                        const hours = Number(e.target.value);
                        if (!Number.isFinite(hours) || hours <= 0) return;
                        const minutes = Math.max(15, Math.round((hours * 60) / 15) * 15);
                        setDurationMinutes(minutes);
                        setNextSlotOptions([]);
                    }}
                    disabled={!canBook || isOwner || busy}
                />
            </label>

            <div className="rowInline">
                <span className="tiny muted">Ends</span>
                <span className="badge">{formatLocalDateTime(endDateTime)}</span>
            </div>
            <div className="rowInline">
                <span className="tiny muted">Estimated total</span>
                <span className="badge">
                    {estimatedTotal > 0 ? `£${estimatedTotal.toFixed(2)}` : "Free"}
                </span>
            </div>
            <div className={`slotStatus ${slotStatus.ok ? "slotStatus--ok" : "slotStatus--bad"}`}>
                {slotStatus.label}
            </div>

            <div className="payToggle">
                <button
                    type="button"
                    className={`payToggleBtn ${payMethod === "money" ? "active" : ""}`}
                    onClick={() => setPayMethod("money")}
                    disabled={!canBook || isOwner || busy}
                >
                    Card
                </button>
                {canUsePoints && (
                    <button
                        type="button"
                        className={`payToggleBtn ${payMethod === "points" ? "active" : ""}`}
                        onClick={() => setPayMethod("points")}
                        disabled={!canBook || isOwner || busy}
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
                        min={pointsMin}
                        step={1}
                        value={pointsAmount}
                        onChange={(e) => setPointsAmount(e.target.value)}
                        disabled={!canBook || isOwner || busy}
                        placeholder={`Minimum ${pointsMin} pts`}
                    />
                    <div className="tiny muted">Minimum {pointsMin} pts for this time slot.</div>
                </label>
            )}

            <div className="rowInline">
                <button
                    onClick={createBooking}
                    disabled={!canBook || isOwner || busy || !slotStatus.ok}
                    className="btn btn-primary"
                >
                    {busy
                        ? "Booking..."
                        : payMethod === "money"
                            ? "Continue to payment"
                            : "Confirm points booking"}
                </button>
                {actionMsg && (
                    <div className="tiny">
                        {actionMsg}
                    </div>
                )}
            </div>

            {conflicts.length > 0 && (
                <div className="spotAlert">
                    {fullyBooked
                        ? "This spot is fully booked during your selected time."
                        : "This spot has some bookings during your selected time."}
                </div>
            )}

        </div>
    );

    return (
        <div className="container">
            <div className="spotDetails">
                <aside className="spotMedia">
                    <Link to="/" className="muted tiny" style={{ textDecoration: "none" }}>← Back to results</Link>
                    <div className="card spotMediaCard">
                        {spot.image_url ? (
                            <img src={spot.image_url} alt={spot.title} className="spotHeroImg" />
                        ) : (
                            <div className="spotHeroFallback">No photo</div>
                        )}
                    </div>

                    <div className="card spotMediaCard">
                        <div className="h3">Location map</div>
                        <div className="muted tiny" style={{ marginTop: 4 }}>Pinpointed for this listing.</div>
                        {Number.isFinite(spot.lat) && Number.isFinite(spot.lng) ? (
                            <div className="spotMapWrap" style={{ marginTop: 10 }}>
                                <SpotsMap spots={[spot]} center={{ lat: spot.lat, lng: spot.lng }} selectedId={spot.id} />
                            </div>
                        ) : (
                            <div className="tiny muted" style={{ marginTop: 10 }}>Map unavailable for this listing.</div>
                        )}
                    </div>
                </aside>

                <main className="spotMain">
                    <div className={`card spotHeader ${auctionClosed ? "spotHeader--ended" : ""}`}>
                        <div className="spotHeaderTop">
                            <div>
                                <div className="heroKicker">PARKINGBUDDIES</div>
                                <div className="heroTitle" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                                    <span>{spot.title}</span>
                                    {spot.mode === "auction" && auctionTimeLeftLabel && !auctionClosed && (
                                        <span className="badge badge--warm">
                                            {auctionTimeLeftLabel}
                                        </span>
                                    )}
                                </div>
                                {spot.mode === "auction" && auctionClosed && (
                                    <div className="spotEndedHeadline">{auctionClosedHeadline}</div>
                                )}
                                <div className="muted" style={{ marginTop: 6 }}>{spot.description}</div>
                                <div className="rowInline" style={{ marginTop: 8, gap: 8, flexWrap: "wrap" }}>
                                    <span className="badge badge--cool">
                                        {capacity === 1 ? "1 Spot" : `${capacity} Spots`}
                                    </span>
                                    {capacity > 1 && (
                                        <span className={`badge ${spotsRemaining > 0 ? "badge--green" : "badge--rose"}`}>
                                            {spotsRemaining} left for selected time
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="pill">
                                <div>{pill}</div>
                                {showPoints && (
                                    <div className="pillSub">
                                        <div className="pillOr">OR</div>
                                        <div>{spot.points_cost} pts</div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="card spotInfo spotInfo--cards">
                        <div className="spotInfoHeader">
                            <div className="h3">Listing details</div>
                        </div>
                        <div className="spotInfoPrimary">
                            <div className="spotInfoCard spotInfoCard--primary">
                                <div className="spotInfoLabel">Price</div>
                                <div className="spotInfoValue spotInfoValue--price">{priceLabel}</div>
                                {showPoints && (
                                    <div className="spotInfoOr">
                                        <div className="spotInfoOrLine">OR</div>
                                        <div className="spotInfoValue spotInfoValue--points">{spot.points_cost} pts</div>
                                    </div>
                                )}
                                <div className="spotInfoSub">Per {capitalizeWord(effectiveUnit)}</div>
                            </div>
                            <div className="spotInfoCard spotInfoCard--primary">
                                <div className="spotInfoLabel">Availability</div>
                                <div className="spotInfoValue">{availabilityLabel}</div>
                            </div>
                            {nextWindow && (
                                <div className="spotInfoCard spotInfoCard--primary">
                                    <div className="spotInfoLabel">Next available</div>
                                    <div className="spotInfoValue">{formatWindow(nextWindow.start, nextWindow.end)}</div>
                                </div>
                            )}
                        </div>
                        <div className="spotInfoCards spotInfoCards--secondary">
                            <div className="spotInfoCard spotInfoCard--secondary">
                                <div className="spotInfoLabel">Address</div>
                                <div className="spotInfoValue">{spot.address_text}</div>
                            </div>
                            <div className="spotInfoCard spotInfoCard--secondary">
                                <div className="spotInfoLabel">Listing type</div>
                                <div className="spotInfoValue">{formatModeLabel(spot.mode)}</div>
                            </div>
                            <div className="spotInfoCard spotInfoCard--secondary">
                                <div className="spotInfoLabel">Parking type</div>
                                <div className="spotInfoValue">{formatModeLabel((spot as any).parking_type ?? "private")}</div>
                            </div>
                            <div className="spotInfoCard spotInfoCard--secondary">
                                <div className="spotInfoLabel">Spots</div>
                                <div className="spotInfoValue">
                                    {capacity > 1
                                        ? `${spotsRemaining}/${capacity} available for selected slot`
                                        : "1 total"}
                                </div>
                            </div>
                        </div>
                    </div>

                    {spot.mode === "auction" ? (
                        <div className="card spotBook">
                            <div className="spotBookHeader">
                                <div className="h3">Auction bidding</div>
                                <div className="muted tiny">Place a bid or review the highest offer.</div>
                            </div>

                            {!canBook && (
                                <div className="spotAlert">
                                    Please <Link to="/login">log in</Link> to bid.
                                </div>
                            )}

                            {isOwner && (
                                <div className="spotAlert">
                                    You’re the owner of this listing.
                                </div>
                            )}
                            {auctionSoldOut && (
                                <div className="spotAlert">
                                    This auction is sold out. No time slots remaining.
                                </div>
                            )}

                            {auctionSoldOut && (
                                <div className="rowInline">
                                    <span className="badge badge--rose">Sold out</span>
                                </div>
                            )}

                            {!isOwner && (
                                <>
                                    <div className="rowInline" style={{ marginBottom: 6 }}>
                                        <button
                                            type="button"
                                            className="btn"
                                            onClick={findNextAvailableSlots}
                                            disabled={!canBook || busy || bidBusy || auctionSoldOut}
                                        >
                                            Next available slot
                                        </button>
                                        <div className="tiny muted">We’ll apply the nearest slot with the longest available duration.</div>
                                    </div>
                                    {nextSlotOptions.length > 1 && (
                                        <div className="rowInline" style={{ marginTop: 6, flexWrap: "wrap" }}>
                                            {nextSlotOptions.slice(1, 4).map((slot, i) => (
                                                <button
                                                    key={`${slot.start.toISOString()}-${slot.minutes}-${i}`}
                                                    type="button"
                                                    className="btn"
                                                    onClick={() => setSlot(slot.start, slot.minutes, "Alternate available slot applied.")}
                                                    disabled={!canBook || busy || bidBusy || auctionSoldOut}
                                                >
                                                    {formatSlotLabel(slot.start, slot.minutes)}
                                                </button>
                                            ))}
                                        </div>
                                    )}

                                    <div className="row">
                                        <label>
                                            <span>Start date</span>
                                            <input
                                                className="input"
                                                type="date"
                                                value={startDate}
                                                onChange={(e) => handleDateChange(e.target.value)}
                                                disabled={!canBook || busy || bidBusy || auctionSoldOut}
                                            />
                                        </label>
                                        <label>
                                            <span>Start time</span>
                                            <input
                                                className="input"
                                                type="time"
                                                value={startTime}
                                                onChange={(e) => setStartTime(e.target.value)}
                                                disabled={!canBook || busy || bidBusy || auctionSoldOut}
                                            />
                                        </label>
                                    </div>
                                    {availabilityCalendar}
                                    <label>
                                        <span>Duration</span>
                                        <select
                                            className="input"
                                            value={durationMinutes}
                                            onChange={(e) => {
                                                setDurationMinutes(Number(e.target.value));
                                                setNextSlotOptions([]);
                                            }}
                                            disabled={!canBook || busy || bidBusy || auctionSoldOut}
                                        >
                                            {(() => {
                                                const max = getMaxDurationMinutes(spot, startDate, startTime);
                                                const options = getDurationOptions(max);
                                                if (!options.length) {
                                                    return <option value={15}>No valid durations</option>;
                                                }
                                                return options.map((o) => (
                                                    <option key={o.minutes} value={o.minutes}>
                                                        {o.label}
                                                    </option>
                                                ));
                                            })()}
                                        </select>
                                    </label>
                                    <div className={`slotStatus ${slotStatus.ok ? "slotStatus--ok" : "slotStatus--bad"}`}>
                                        {slotStatus.label}
                                    </div>

                                    <div className="payToggle">
                                        <button
                                            type="button"
                                            className={`payToggleBtn ${bidPayMethod === "money" ? "active" : ""}`}
                                            onClick={() => setBidPayMethod("money")}
                                            disabled={!canBook || busy || bidBusy || auctionSoldOut}
                                        >
                                            Money
                                        </button>
                                        {showPoints && (
                                            <button
                                                type="button"
                                                className={`payToggleBtn ${bidPayMethod === "points" ? "active" : ""}`}
                                                onClick={() => setBidPayMethod("points")}
                                                disabled={!canBook || busy || bidBusy || auctionSoldOut}
                                            >
                                                Points
                                            </button>
                                        )}
                                    </div>

                                    {bidPayMethod === "money" && (
                                        <>
                                            <label>
                                                <span>Your bid (£ per hour)</span>
                                                <div className="rowInline" style={{ alignItems: "stretch" }}>
                                                    <input
                                                        className="input"
                                                        type="number"
                                                        min={minBidPerHour || 0}
                                                        step="0.5"
                                                        value={bidAmount}
                                                        onChange={(e) => setBidAmount(e.target.value)}
                                                        disabled={!canBook || busy || bidBusy || auctionSoldOut}
                                                        placeholder="e.g. 12.00"
                                                        style={{ flex: 1, minWidth: 160 }}
                                                    />
                                                    <div style={{ display: "grid", alignItems: "start", justifyItems: "center", minWidth: 92 }}>
                                                        <div className="tiny muted" style={{ marginBottom: 4 }}>Total</div>
                                                        <div
                                                            className="badge"
                                                            style={{
                                                                display: "grid",
                                                                placeItems: "center",
                                                                padding: "0 12px",
                                                                minWidth: 92,
                                                                borderRadius: 999,
                                                                border: "1px solid rgba(255,255,255,0.12)",
                                                                background: "rgba(255,255,255,0.06)",
                                                            }}
                                                        >
                                                            {bidTotalMoney > 0 ? `£${bidTotalMoney.toFixed(2)}` : "—"}
                                                        </div>
                                                    </div>
                                                </div>
                                            </label>
                                            {bidTotalMoney > 0 && (
                                                <div className="tiny muted" style={{ marginTop: 4 }}>
                                                    £{Number(bidAmount || 0).toFixed(2)} x {bidUnits.toFixed(2)} hours = £{bidTotalMoney.toFixed(2)}
                                                </div>
                                            )}

                                            <div className="rowInline">
                                                <button
                                                    onClick={goToBidConfirm}
                                                    disabled={!canBook || busy || bidBusy || auctionSoldOut || !slotStatus.ok}
                                                    className="btn btn-primary"
                                                >
                                                    Authorize bid
                                                </button>
                                                {bidMsg && <div className="tiny muted">{bidMsg}</div>}
                                            </div>

                                        </>
                                    )}

                                    {bidPayMethod === "points" && (
                                        <>
                                            <label>
                                                <span>Your bid (points per hour)</span>
                                                <div className="rowInline" style={{ alignItems: "stretch" }}>
                                                    <input
                                                        className="input"
                                                        type="number"
                                                        min={Number(spot.points_cost ?? 0)}
                                                        step={1}
                                                        value={bidPointsAmount}
                                                        onChange={(e) => setBidPointsAmount(e.target.value)}
                                                        disabled={!canBook || busy || bidBusy || auctionSoldOut}
                                                        placeholder={`Minimum bid amount per hour`}
                                                        style={{ flex: 1, minWidth: 160 }}
                                                    />
                                                    <div style={{ display: "grid", alignItems: "start", justifyItems: "center", minWidth: 92 }}>
                                                        <div className="tiny muted" style={{ marginBottom: 4 }}>Total</div>
                                                        <div
                                                            className="badge"
                                                            style={{
                                                                display: "grid",
                                                                placeItems: "center",
                                                                padding: "0 12px",
                                                                minWidth: 92,
                                                                borderRadius: 999,
                                                                border: "1px solid rgba(255,255,255,0.12)",
                                                                background: "rgba(255,255,255,0.06)",
                                                            }}
                                                        >
                                                            {bidTotalPoints > 0 ? `${bidTotalPoints} pts` : "—"}
                                                        </div>
                                                    </div>
                                                </div>
                                            </label>
                                            {bidTotalPoints > 0 && (
                                                <div className="tiny muted" style={{ marginTop: 4 }}>
                                                    {Number(bidPointsAmount || 0)} pts x {bidUnits.toFixed(2)} hours = {bidTotalPoints} pts
                                                </div>
                                            )}
                                            <div className="rowInline">
                                                <button
                                                    onClick={goToBidConfirm}
                                                    disabled={!canBook || busy || bidBusy || auctionSoldOut || bidPointsInsufficient || !slotStatus.ok}
                                                    className="btn btn-primary"
                                                >
                                                    Review bid
                                                </button>
                                                {bidMsg && <div className="tiny muted">{bidMsg}</div>}
                                            </div>
                                        </>
                                    )}
                                </>
                            )}

                        </div>
                    ) : (
                        bookingPanel
                    )}
                    {bidsFooterSection}
                    {myBidsFooterSection}
                </main>
            </div>
        </div>
    );
}

function formatAvailability(spot: ParkingSpot) {
    const a = spot.availability_json;
    const dateRange = a?.date_from || a?.date_to
        ? ` (${formatYmdToDmy(a?.date_from)} to ${formatYmdToDmy(a?.date_to)})`
        : "";
    if (a?.type === "24_7") return `24/7${dateRange}`;
    if (a?.type === "same_everyday" && a.start && a.end) return `Daily ${a.start}–${a.end}${dateRange}`;
    if (a?.type === "custom_weekly" && Array.isArray(a.rules)) {
        const labels = a.rules
            .map((r) => `${dowLabel(r.dow)} ${r.start}–${r.end}`)
            .join(", ");
        return labels ? `${labels}${dateRange}` : "Custom weekly";
    }

    // Legacy fallback
    if (spot.availability_type === "24_7") return "24/7";
    if (spot.availability_type === "weekly" && Array.isArray(spot.available_days)) {
        const ds = spot.daily_start?.slice(0, 5);
        const de = spot.daily_end?.slice(0, 5);
        const days = spot.available_days.map(dowLabel).join(", ");
        if (ds && de) return `${days} ${ds}–${de}`;
        return `${days} (weekly)`;
    }

    return "Not specified";
}

function dowLabel(dow: number) {
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dow] ?? "Day";
}

function extractAvailabilityRules(spot: ParkingSpot): Array<{ dow: number; start: string; end: string }> {
    const rules: Array<{ dow: number; start: string; end: string }> = [];

    const a = spot.availability_json;
    if (a?.type === "24_7") {
        return Array.from({ length: 7 }).map((_, dow) => ({ dow, start: "00:00", end: "23:59" }));
    }
    if (a?.type === "same_everyday" && a.start && a.end) {
        const dayStart = a.start;
        const dayEnd = a.end;
        return Array.from({ length: 7 }).map((_, dow) => ({ dow, start: dayStart, end: dayEnd }));
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
        const ds = spot.daily_start?.slice(0, 5) ?? "00:00";
        const de = spot.daily_end?.slice(0, 5) ?? "23:59";
        return spot.available_days.map((dow) => ({ dow, start: ds, end: de }));
    }

    return rules;
}

function setTime(d: Date, hhmm: string) {
    const [h, m] = hhmm.split(":").map((x) => Number(x));
    const out = new Date(d);
    out.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
    return out;
}

function pad2(n: number) {
    return String(n).padStart(2, "0");
}

function capitalizeWord(value: string) {
    if (!value) return value;
    return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatModeLabel(mode?: string) {
    if (!mode) return "Unknown";
    return capitalizeWord(mode);
}

function formatDateDMY(d: Date) {
    return `${pad2(d.getDate())}:${pad2(d.getMonth() + 1)}:${d.getFullYear()}`;
}

function formatYmdToDmy(ymd?: string | null) {
    if (!ymd) return "…";
    const parts = ymd.split("-");
    if (parts.length === 3 && parts[0].length === 4) {
        const [y, m, d] = parts;
        return `${pad2(Number(d))}:${pad2(Number(m))}:${y}`;
    }
    const parsed = new Date(ymd);
    if (!Number.isNaN(parsed.getTime())) return formatDateDMY(parsed);
    return ymd;
}

function localDateStr(d: Date) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function localTimeStr(d: Date) {
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function nextWholeHour() {
    const now = new Date();
    const d = new Date(now);
    d.setMinutes(0, 0, 0);
    if (d <= now) d.setHours(d.getHours() + 1);
    return d;
}

function addMinutes(d: Date, minutes: number) {
    return new Date(d.getTime() + minutes * 60 * 1000);
}

function formatLocalDateTime(d: Date) {
    try {
        return `${formatDateDMY(d)} ${localTimeStr(d)}`;
    } catch {
        return `${formatDateDMY(d)} ${localTimeStr(d)}`;
    }
}

function roundToNextQuarter(d: Date) {
    const out = new Date(d);
    const minutes = out.getMinutes();
    const rounded = Math.ceil(minutes / 15) * 15;
    out.setMinutes(rounded, 0, 0);
    return out;
}

function parseYmd(ymd: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
    const parsed = new Date(`${ymd}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfMonth(d: Date) {
    const out = new Date(d);
    out.setDate(1);
    out.setHours(0, 0, 0, 0);
    return out;
}

function addMonths(d: Date, months: number) {
    const out = new Date(d);
    out.setMonth(out.getMonth() + months);
    out.setDate(1);
    out.setHours(0, 0, 0, 0);
    return out;
}

function formatCalendarMonth(d: Date) {
    return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function buildCalendarGrid(monthStart: Date) {
    const first = startOfMonth(monthStart);
    const firstWeekday = first.getDay();
    const gridStart = new Date(first);
    gridStart.setDate(first.getDate() - firstWeekday);
    const days: Date[] = [];
    for (let i = 0; i < 42; i += 1) {
        const day = new Date(gridStart);
        day.setDate(gridStart.getDate() + i);
        days.push(day);
    }
    return days;
}

function formatWindow(start: Date, end: Date) {
    return `${dowLabel(start.getDay())} ${formatDateDMY(start)} ${localTimeStr(start)}–${localTimeStr(end)}`;
}

function formatSlotLabel(start: Date, minutes: number) {
    const end = addMinutes(start, minutes);
    return `${dowLabel(start.getDay())} ${localTimeStr(start)}–${localTimeStr(end)}`;
}

function formatCompactDuration(minutes: number) {
    const mins = Math.max(0, Math.floor(minutes));
    const days = Math.floor(mins / (24 * 60));
    const hours = Math.floor((mins % (24 * 60)) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h`;
    return `${mins}m`;
}

function formatBidWindow(start?: string, end?: string) {
    if (!start || !end) return "Time not set";
    return `${formatLocalDateTime(new Date(start))} → ${formatLocalDateTime(new Date(end))}`;
}

function isSlotAllowed(spot: ParkingSpot, start: Date, end: Date) {
    if (!(start < end)) return false;
    const rules = extractAvailabilityRules(spot);
    if (!rules.length) return true;

    const a = spot.availability_json;
    const dateFrom = a?.date_from ? new Date(`${a.date_from}T00:00:00`) : null;
    const dateTo = a?.date_to ? new Date(`${a.date_to}T23:59:59`) : null;
    if (dateFrom && start < dateFrom) return false;
    if (dateTo && end > dateTo) return false;

    if (start.toDateString() !== end.toDateString()) return false;
    const dow = start.getDay();
    const dayRules = rules.filter((r) => r.dow === dow);
    if (!dayRules.length) return false;

    for (const r of dayRules) {
        const ruleStart = setTime(start, r.start);
        const ruleEnd = setTime(start, r.end);
        if (start >= ruleStart && end <= ruleEnd) return true;
    }
    return false;
}

function formatCountdown(ms: number) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}

function calcUnitsForMinutes(minutes: number, unit: "hour" | "day" | "week") {
    if (!Number.isFinite(minutes) || minutes <= 0) return 0;
    if (unit === "hour") {
        const roundedMinutes = Math.max(5, Math.ceil(minutes / 5) * 5);
        return roundedMinutes / 60;
    }
    if (unit === "day") return Math.max(1, Math.ceil(minutes / (60 * 24)));
    return Math.max(1, Math.ceil(minutes / (60 * 24 * 7)));
}

function getDurationOptions(maxMinutes = 30 * 24 * 60) {
    const options: Array<{ label: string; minutes: number }> = [];
    for (let m = 15; m <= 8 * 60; m += 15) {
        const hours = m / 60;
        if (m <= maxMinutes) {
            options.push({ label: m < 60 ? `${m} minutes` : `${hours} hour${hours === 1 ? "" : "s"}`, minutes: m });
        }
    }
    for (let h = 9; h <= 23; h += 1) {
        const minutes = h * 60;
        if (minutes <= maxMinutes) {
            options.push({ label: `${h} hours`, minutes });
        }
    }
    for (let d = 1; d <= 30; d += 1) {
        const minutes = d * 24 * 60;
        if (minutes <= maxMinutes) {
            options.push({ label: `${d} day${d === 1 ? "" : "s"}`, minutes });
        }
    }
    return options;
}

function getMaxDurationMinutes(spot: ParkingSpot, startDate: string, startTime: string) {
    const a: any = spot.availability_json;
    const dateFrom = a?.date_from ? new Date(`${a.date_from}T00:00:00`) : null;
    const dateTo = a?.date_to ? new Date(`${a.date_to}T23:59:59`) : null;

    let start = new Date(`${startDate}T${startTime}`);
    if (Number.isNaN(start.getTime())) {
        start = dateFrom ? new Date(dateFrom) : new Date();
    }
    if (dateFrom && start < dateFrom) start = new Date(dateFrom);

    let maxMinutes = 30 * 24 * 60;
    if (dateTo) {
        const diff = Math.floor((dateTo.getTime() - start.getTime()) / 60000);
        maxMinutes = Math.min(maxMinutes, diff);
    }
    return Math.max(0, maxMinutes);
}

function getNextAvailableWindow(spot: ParkingSpot, bookings: Booking[]) {
    const segments = getAvailabilitySegments(spot, bookings, 30);
    if (segments.length > 0) {
        return { start: segments[0].start, end: segments[0].end };
    }
    return null;
}

function getNextSlots(spot: ParkingSpot, bookings: Booking[], minutes: number, count = 3) {
    const segments = getAvailabilitySegments(spot, bookings, 30);
    const results: Date[] = [];
    for (const seg of segments) {
        let cursor = new Date(seg.start);
        while (addMinutes(cursor, minutes) <= seg.end) {
            results.push(new Date(cursor));
            if (results.length >= count) return results;
            cursor = addMinutes(cursor, 15);
        }
    }
    return results;
}

function getAvailabilitySegments(spot: ParkingSpot, bookings: Booking[], daysForward = 30) {
    const windows = buildAvailabilityWindows(spot, daysForward);
    const capacity = Math.max(1, Number((spot as any)?.capacity_total ?? 1));
    const now = roundToNextQuarter(new Date());
    const normalized = bookings
        .filter((b) => b.start_time && b.end_time)
        .map((b) => ({ start: new Date(b.start_time as string), end: new Date(b.end_time as string) }))
        .sort((a, b) => a.start.getTime() - b.start.getTime());

    const segments: Array<{ start: Date; end: Date }> = [];
    for (const window of windows) {
        const freeSegments = subtractBookings(window, normalized, capacity);
        for (const seg of freeSegments) {
            const roundedStart = roundToNextQuarter(seg.start < now ? now : seg.start);
            if (roundedStart < seg.end) {
                segments.push({ start: roundedStart, end: seg.end });
            }
        }
    }
    return segments.sort((a, b) => a.start.getTime() - b.start.getTime());
}

function toSlotOption(segment: { start: Date; end: Date }): SlotOption | null {
    const minutesRaw = Math.floor((segment.end.getTime() - segment.start.getTime()) / 60000);
    const roundedMinutes = Math.floor(minutesRaw / 15) * 15;
    if (roundedMinutes < 15) return null;
    return { start: segment.start, minutes: roundedMinutes };
}

function getNearestLongestSlotsFromSegments(segments: Array<{ start: Date; end: Date }>, count = 4) {
    const options: SlotOption[] = [];
    for (const segment of segments) {
        const option = toSlotOption(segment);
        if (!option) continue;
        options.push(option);
        if (options.length >= count) break;
    }
    return options;
}

function buildLongestSlotsByDate(segments: Array<{ start: Date; end: Date }>) {
    const map: Record<string, SlotOption> = {};
    for (const segment of segments) {
        const option = toSlotOption(segment);
        if (!option) continue;
        const key = localDateStr(option.start);
        const existing = map[key];
        if (!existing || option.minutes > existing.minutes) {
            map[key] = option;
        }
    }
    return map;
}

function getSlotsForDateFromSegments(
    segments: Array<{ start: Date; end: Date }>,
    dateKey: string,
    count = 4
) {
    const options: SlotOption[] = [];
    for (const segment of segments) {
        const option = toSlotOption(segment);
        if (!option) continue;
        if (localDateStr(option.start) !== dateKey) continue;
        options.push(option);
    }
    options.sort((a, b) => a.start.getTime() - b.start.getTime());
    return options.slice(0, count);
}

function buildAvailabilityWindows(spot: ParkingSpot, daysForward: number) {
    const rules = extractAvailabilityRules(spot);
    if (!rules.length) return [];

    const a: any = (spot as any).availability_json;
    const dateFrom = a?.date_from ? new Date(`${a.date_from}T00:00:00`) : null;
    const dateTo = a?.date_to ? new Date(`${a.date_to}T23:59:59`) : null;

    const now = new Date();
    const startDay = dateFrom && dateFrom > now ? new Date(dateFrom) : new Date(now);
    startDay.setHours(0, 0, 0, 0);
    const endCap = new Date(startDay);
    endCap.setDate(endCap.getDate() + daysForward);
    const endDay = dateTo && dateTo < endCap ? new Date(dateTo) : endCap;
    endDay.setHours(23, 59, 59, 999);

    const windows: Array<{ start: Date; end: Date }> = [];
    for (let day = new Date(startDay); day <= endDay; day.setDate(day.getDate() + 1)) {
        const d = new Date(day);
        if (dateFrom && d < dateFrom) continue;
        if (dateTo && d > dateTo) continue;

        const dow = d.getDay();
        const dayRules = rules.filter((r) => r.dow === dow);
        for (const r of dayRules) {
            const start = setTime(d, r.start);
            const end = setTime(d, r.end);
            if (end <= now) continue;
            windows.push({ start, end });
        }
    }
    return windows;
}

function subtractBookings(
    window: { start: Date; end: Date },
    bookings: Array<{ start: Date; end: Date }>,
    capacity = 1
) {
    const safeCapacity = Math.max(1, Number.isFinite(capacity) ? Math.floor(capacity) : 1);

    if (safeCapacity > 1) {
        const events: Array<{ at: number; delta: number }> = [];
        for (const b of bookings) {
            if (b.end <= window.start || b.start >= window.end) continue;
            const startMs = Math.max(window.start.getTime(), b.start.getTime());
            const endMs = Math.min(window.end.getTime(), b.end.getTime());
            if (endMs <= startMs) continue;
            events.push({ at: startMs, delta: 1 });
            events.push({ at: endMs, delta: -1 });
        }

        if (!events.length) return [{ ...window }];

        events.sort((a, b) => (a.at === b.at ? a.delta - b.delta : a.at - b.at));
        const blocked: Array<{ start: Date; end: Date }> = [];
        let active = 0;
        let blockedStart: number | null = null;

        for (const event of events) {
            const before = active;
            active += event.delta;
            if (before < safeCapacity && active >= safeCapacity) {
                blockedStart = event.at;
            }
            if (before >= safeCapacity && active < safeCapacity && blockedStart != null && event.at > blockedStart) {
                blocked.push({ start: new Date(blockedStart), end: new Date(event.at) });
                blockedStart = null;
            }
        }

        let segments: Array<{ start: Date; end: Date }> = [{ ...window }];
        for (const b of blocked) {
            const next: Array<{ start: Date; end: Date }> = [];
            for (const seg of segments) {
                if (b.end <= seg.start || b.start >= seg.end) {
                    next.push(seg);
                } else {
                    if (b.start > seg.start) next.push({ start: seg.start, end: b.start });
                    if (b.end < seg.end) next.push({ start: b.end, end: seg.end });
                }
            }
            segments = next;
        }
        return segments;
    }

    let segments: Array<{ start: Date; end: Date }> = [{ ...window }];
    for (const b of bookings) {
        if (b.end <= window.start || b.start >= window.end) continue;
        const next: Array<{ start: Date; end: Date }> = [];
        for (const seg of segments) {
            if (b.end <= seg.start || b.start >= seg.end) {
                next.push(seg);
            } else {
                if (b.start > seg.start) next.push({ start: seg.start, end: b.start });
                if (b.end < seg.end) next.push({ start: b.end, end: seg.end });
            }
        }
        segments = next;
    }
    return segments;
}
