import { useEffect, useMemo, useState } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
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

    const [spot, setSpot] = useState<ParkingSpot | null>(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);

    const [startDate, setStartDate] = useState(() => localDateStr(nextWholeHour()));
    const [startTime, setStartTime] = useState(() => localTimeStr(nextWholeHour()));
    const [durationMinutes, setDurationMinutes] = useState(60);
    const [payMethod, setPayMethod] = useState<"money" | "points">("money");

    const [booking, setBooking] = useState<Booking | null>(null);
    const [actionMsg, setActionMsg] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [spotBookings, setSpotBookings] = useState<Booking[]>([]);

    const [clientSecret, setClientSecret] = useState<string | null>(null);
    const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);

    const [bidAmount, setBidAmount] = useState("");
    const [bidMsg, setBidMsg] = useState<string | null>(null);
    const [bidBusy, setBidBusy] = useState(false);
    const [nextSlotOptions, setNextSlotOptions] = useState<Date[]>([]);
    const [auctionInfo, setAuctionInfo] = useState<{
        highest_pending_bid_gbp: number;
        auction_end?: string | null;
        auction_start_price_gbp?: number | null;
        pending_bids?: Array<{ id: string; amount_gbp: number; status: string; start_time?: string; end_time?: string; bidder_name?: string; bidder_email?: string }>;
        approved_bids?: Array<{ id: string; amount_gbp: number; status: string; start_time?: string; end_time?: string; created_at?: string }>;
        sold_out?: boolean;
    } | null>(null);
    const [auctionMe, setAuctionMe] = useState<{ status?: string; amount_gbp?: number; start_time?: string; end_time?: string } | null>(null);

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

    useEffect(() => {
        if (!id) return;
        apiGet<{ bookings: Booking[] }>(`/bookings/spot/${id}`)
            .then((r) => setSpotBookings(r.bookings ?? []))
            .catch(() => setSpotBookings([]));
    }, [id]);

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
                const meR = await apiGet<{ me: any }>(`/auctions/${spot.id}/me`, token);
                setAuctionMe(meR.me ?? null);
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
        setNextSlotOptions([]);
    }, [durationMinutes, spot?.id]);

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


    const price = useMemo(() => Number(spot?.price_gbp ?? 0), [spot]);
    const highestPending = Number(auctionInfo?.highest_pending_bid_gbp ?? 0);
    const auctionStart = Number(spot?.auction_start_price_gbp ?? 0);
    const auctionPriceLabel = highestPending > 0
        ? `Highest pending £${highestPending.toFixed(2)}`
        : `Start £${auctionStart.toFixed(2)}`;
    const priceLabel =
        spot?.mode === "auction"
            ? auctionPriceLabel
            : price > 0
                ? `£${price.toFixed(2)}`
                : "Free";
    const unit = (spot?.price_unit ?? "hour") as "hour" | "day" | "week";
    const auctionBidPrice = Number(auctionMe?.amount_gbp ?? 0);
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
    const capacity = Number((spot as any)?.capacity_total ?? 1);
    const fullyBooked = conflicts.length >= Math.max(1, capacity);

    function toIso(date: string, time: string) {
        return new Date(`${date}T${time}`).toISOString();
    }

    function setSlot(d: Date, minutes: number, msg?: string) {
        const startD = new Date(d);
        setStartDate(localDateStr(startD));
        setStartTime(localTimeStr(startD));
        setDurationMinutes(minutes);
        const endD = addMinutes(startD, minutes);
        setActionMsg(msg ?? `Slot set: ${formatLocalDateTime(startD)} → ${formatLocalDateTime(endD)}.`);
    }

    const findNextSlots = () => {
        if (!spot) return;
        const slots = getNextSlots(spot, spotBookings, durationMinutes, 3);
        if (!slots.length) {
            setActionMsg("No available slot found. Try another time or duration.");
            return;
        }
        setSlot(slots[0], durationMinutes, "Next available slot applied.");
        setNextSlotOptions(slots);
    };

    const findNextHourSlots = () => {
        if (!spot) return;
        const slots = getNextNonOverlappingSlots(spot, spotBookings, 60, 4);
        if (!slots.length) {
            setBidMsg("No 1-hour slots available.");
            return;
        }
        setSlot(slots[0], 60, "Next 1-hour slot applied.");
        setBidMsg("Next 1-hour slot applied.");
        setNextSlotOptions(slots);
    };

    async function createBooking() {
        if (!token) {
            setActionMsg("You must be logged in to book.");
            return;
        }
        if (!spot) return;

        setBusy(true);
        setActionMsg(null);
        setClientSecret(null);
        setPaymentIntentId(null);

        try {
            const body = {
                parking_spot_id: spot.id,
                start_time: toIso(startDate, startTime),
                end_time: toIso(localDateStr(endDateTime), localTimeStr(endDateTime)),
                pay_method: payMethod,
            };

            const res = await apiPost<{ booking: Booking }>("/bookings", body, token);
            setBooking(res.booking);
            setActionMsg("Booking created (pending).");
        } catch (e: any) {
            setActionMsg(e.message || "Booking failed");
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

        const amount = Number(bidAmount);
        if (!Number.isFinite(amount) || amount <= 0) {
            setBidMsg("Enter a valid bid amount.");
            return;
        }

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

    async function placeBid() {
        if (!token || !spot) return;
        if (auctionSoldOut) {
            setBidMsg("This auction is sold out.");
            return;
        }
        const amount = Number(bidAmount);
        if (!Number.isFinite(amount) || amount <= 0) {
            setBidMsg("Enter a valid bid amount.");
            return;
        }
        if (!paymentIntentId) {
            setBidMsg("Missing payment authorization. Please try again.");
            return;
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
            await apiPost<{ auction: any }>(
                `/auctions/${spot.id}/bid`,
                {
                    amount_gbp: amount,
                    payment_intent_id: paymentIntentId,
                    start_time: bidStart.toISOString(),
                    end_time: bidEnd.toISOString(),
                },
                token
            );
            setBidMsg("Bid placed. Awaiting owner approval.");
            setClientSecret(null);
            setPaymentIntentId(null);
            setBidAmount("");
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

    const showPoints = !!spot.allow_points && !!spot.points_cost;
    const canUsePoints = showPoints && spot.mode === "rent";
    const pointsLabel = showPoints ? `${spot.points_cost} pts ${priceUnitLabel(price)}` : "";
    const availabilityLabel = formatAvailability(spot);

    const approvedBids = auctionInfo?.approved_bids ?? [];
    const pendingBids = auctionInfo?.pending_bids ?? [];

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
                    {nextSlotOptions.slice(1).map((d, i) => (
                        <button
                            key={`${d.toISOString()}-${i}`}
                            type="button"
                            className="btn"
                            onClick={() => setSlot(d, durationMinutes, "Alternate slot applied.")}
                            disabled={!canBook || isOwner || busy}
                        >
                            {formatSlotLabel(d, durationMinutes)}
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
                        onChange={(e) => setStartDate(e.target.value)}
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

            <label>
                <span>Payment method</span>
                <select
                    className="input"
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value as any)}
                    disabled={!canBook || isOwner || busy}
                >
                    <option value="money">Money</option>
                    {canUsePoints && <option value="points">Points</option>}
                </select>
            </label>

            <div className="rowInline">
                <button
                    onClick={createBooking}
                    disabled={!canBook || isOwner || busy}
                    className="btn btn-primary"
                >
                    Request booking
                </button>
                {actionMsg && (
                    <div className="tiny">
                        {actionMsg}{" "}
                        {booking && (
                            <Link to="/dashboard?tab=myBookings" style={{ textDecoration: "underline" }}>
                                View in dashboard
                            </Link>
                        )}
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

            {booking && (
                <div className="card spotBookingCard">
                    <div className="tiny muted">Booking ID</div>
                    <div>{booking.id}</div>
                    <div className="tiny muted" style={{ marginTop: 6 }}>Status</div>
                    <div>{booking.status} • {booking.pay_method}</div>

                    {booking.pay_method === "money" && price > 0 && (
                        <div style={{ marginTop: 10 }}>
                            <Link to={`/pay/${booking.id}`} className="btn btn-primary">
                                Pay with card
                            </Link>
                        </div>
                    )}
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
                    <div className="card spotHeader">
                        <div className="spotHeaderTop">
                            <div>
                                <div className="heroKicker">PARKINGBUDDIES</div>
                                <div className="heroTitle">{spot.title}</div>
                                <div className="muted" style={{ marginTop: 6 }}>{spot.description}</div>
                            </div>
                            <div className="pill">{pill}</div>
                        </div>

                        <div className="meta">
                            <span className="badge">Listing: {spot.mode}</span>
                            <span className="badge">Location: {spot.address_text}</span>
                            {spot.mode === "auction" && (
                                <span className="badge">
                                    {highestPending > 0
                                        ? `Highest pending £${highestPending.toFixed(2)}`
                                        : `Start £${auctionStart.toFixed(2)}`}
                                </span>
                            )}
                            {spot.mode === "auction" && auctionSoldOut && (
                                <span className="badge badge--rose">Sold out</span>
                            )}
                            {showPoints && <span className="badge">Points: {pointsLabel}</span>}
                        </div>
                    </div>

                    <div className="card spotInfo">
                        <div className="h3">Listing details</div>
                        <div className="spotInfoGrid">
                            <div>
                                <div className="tiny muted">Address</div>
                                <div className="spotInfoValue">{spot.address_text}</div>
                            </div>
                            <div>
                                <div className="tiny muted">Rate</div>
                                <div className="spotInfoValue">{priceLabel}</div>
                            </div>
                            <div>
                                <div className="tiny muted">Availability</div>
                                <div className="spotInfoValue">{availabilityLabel}</div>
                            </div>
                            <div>
                                <div className="tiny muted">Payment options</div>
                                <div className="spotInfoValue">
                                    {canUsePoints ? "Money or points" : "Money only"}
                                </div>
                            </div>
                            <div>
                                <div className="tiny muted">Listing type</div>
                                <div className="spotInfoValue">{spot.mode}</div>
                            </div>
                            <div>
                                <div className="tiny muted">Parking type</div>
                                <div className="spotInfoValue">{(spot as any).parking_type ?? "private"}</div>
                            </div>
                            {(spot as any).parking_type === "public" && (
                                <div>
                                    <div className="tiny muted">Capacity</div>
                                    <div className="spotInfoValue">
                                        {(spot as any).capacity_available ?? 0} / {(spot as any).capacity_total ?? 0} available
                                    </div>
                                </div>
                            )}
                            <div>
                                <div className="tiny muted">Booked slots</div>
                                <div className="spotInfoValue">
                                    {spotBookings.length === 0
                                        ? "No confirmed bookings yet"
                                        : spotBookings.slice(0, 4).map((b) => (
                                            <div key={b.id}>
                                                {b.start_time ? formatLocalDateTime(new Date(b.start_time)) : "?"} → {b.end_time ? formatLocalDateTime(new Date(b.end_time)) : "?"}
                                            </div>
                                        ))}
                                </div>
                            </div>
                            {nextWindow && (
                                <div>
                                    <div className="tiny muted">Next available</div>
                                    <div className="spotInfoValue">
                                        {formatWindow(nextWindow.start, nextWindow.end)}
                                    </div>
                                </div>
                            )}
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

                            <div className="rowInline">
                                <span className="badge badge--warm">
                                    Start £{Number(spot.auction_start_price_gbp ?? 0).toFixed(2)}
                                </span>
                                {highestPending > 0 && (
                                    <span className="badge">
                                        Highest pending £{highestPending.toFixed(2)}
                                    </span>
                                )}
                                {auctionSoldOut && <span className="badge badge--rose">Sold out</span>}
                                {spot.auction_end && (
                                    <span className="badge badge--rose">
                                        Ends {formatLocalDateTime(new Date(spot.auction_end))}
                                    </span>
                                )}
                            </div>

                            {approvedBids.length > 0 && (
                                <div className="stack" style={{ marginTop: 8 }}>
                                    <div className="tiny muted">Recent approved bids</div>
                                    {approvedBids.map((b) => (
                                        <div key={b.id} className="card spotBookingCard">
                                            <div className="rowInline">
                                                <span className="badge badge--green">£{Number(b.amount_gbp).toFixed(2)}</span>
                                                <span className="badge">Approved</span>
                                            </div>
                                            <div className="tiny muted" style={{ marginTop: 6 }}>
                                                {formatBidWindow(b.start_time, b.end_time)}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {pendingBids.length > 0 && (
                                <div className="stack" style={{ marginTop: 8 }}>
                                    <div className="tiny muted">Current bids</div>
                                    {pendingBids.slice(0, 5).map((b) => (
                                        <div key={b.id} className="card spotBookingCard">
                                            <div className="rowInline">
                                                <span className="badge">£{Number(b.amount_gbp).toFixed(2)}</span>
                                                <span className="badge">{b.status}</span>
                                            </div>
                                            <div className="tiny muted" style={{ marginTop: 6 }}>
                                                {formatBidWindow(b.start_time, b.end_time)}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {approvedBids.length === 0 && pendingBids.length === 0 && (
                                <div className="muted tiny" style={{ marginTop: 8 }}>
                                    No bids yet. Starting price £{Number(spot.auction_start_price_gbp ?? 0).toFixed(2)}.
                                </div>
                            )}

                            {auctionMe?.status && (
                                <div className="card spotBookingCard">
                                    <div className="tiny muted">Your bid status</div>
                                    <div>
                                        {auctionMe.status === "pending"
                                            ? "Pending, awaiting owner approval"
                                            : auctionMe.status === "accepted"
                                                ? "Accepted — booking confirmed"
                                                : auctionMe.status === "won"
                                                    ? "Won — awaiting owner approval"
                                                    : auctionMe.status}
                                    </div>
                                    <div className="tiny muted" style={{ marginTop: 6 }}>
                                        <Link to="/dashboard?tab=myAuctionBids" style={{ textDecoration: "underline" }}>
                                            View in dashboard
                                        </Link>
                                    </div>
                                    {auctionMe.amount_gbp != null && (
                                        <div className="tiny muted" style={{ marginTop: 6 }}>
                                            £{Number(auctionMe.amount_gbp).toFixed(2)}
                                        </div>
                                    )}
                                    {auctionMe.start_time && auctionMe.end_time && (
                                        <div className="tiny muted" style={{ marginTop: 6 }}>
                                            {formatBidWindow(auctionMe.start_time, auctionMe.end_time)}
                                        </div>
                                    )}
                                </div>
                            )}

                            {!isOwner && (
                                <>
                                    <div className="rowInline" style={{ marginBottom: 6 }}>
                                        <button
                                            type="button"
                                            className="btn"
                                            onClick={findNextHourSlots}
                                            disabled={!canBook || busy || bidBusy || auctionSoldOut}
                                        >
                                            Next 1-hour slot
                                        </button>
                                        <div className="tiny muted">We’ll place the nearest available 1-hour slot.</div>
                                    </div>
                                    {bidMsg && (
                                        <div className="tiny" style={{ marginBottom: 6 }}>
                                            {bidMsg}
                                        </div>
                                    )}
                                    {nextSlotOptions.length > 1 && (
                                        <div className="rowInline" style={{ marginTop: 6, flexWrap: "wrap" }}>
                                            {nextSlotOptions.slice(1, 4).map((d, i) => (
                                                <button
                                                    key={`${d.toISOString()}-${i}`}
                                                    type="button"
                                                    className="btn"
                                                    onClick={() => setSlot(d, 60, "Alternate 1-hour slot applied.")}
                                                    disabled={!canBook || busy || bidBusy || auctionSoldOut}
                                                >
                                                    {formatSlotLabel(d, 60)}
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
                                                onChange={(e) => setStartDate(e.target.value)}
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
                                    <label>
                                        <span>Duration</span>
                                        <select
                                            className="input"
                                            value={durationMinutes}
                                            onChange={(e) => setDurationMinutes(Number(e.target.value))}
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

                                    <label>
                                        <span>Your bid (£)</span>
                                        <input
                                            className="input"
                                            type="number"
                                            min={0}
                                            step="0.5"
                                            value={bidAmount}
                                            onChange={(e) => setBidAmount(e.target.value)}
                                            disabled={!canBook || busy || bidBusy || auctionSoldOut}
                                            placeholder="e.g. 12.00"
                                        />
                                    </label>

                                    <div className="rowInline">
                                        <button
                                            onClick={startBidAuthorization}
                                            disabled={!canBook || busy || bidBusy || auctionSoldOut}
                                            className="btn btn-primary"
                                        >
                                            Continue to card
                                        </button>
                                    </div>

                                    {clientSecret && (
                                        <Elements stripe={stripePromise} options={{ clientSecret }}>
                                            <BidCardForm
                                                clientSecret={clientSecret}
                                                busy={bidBusy}
                                                onAuthorized={() => {
                                                    if (bidBusy) return;
                                                    setBidMsg("Authorization complete. Placing bid…");
                                                    placeBid();
                                                }}
                                            />
                                        </Elements>
                                    )}
                                </>
                            )}

                            {isOwner && pendingBids.length ? (
                                <div className="stack">
                                    <div className="tiny muted">Incoming bids</div>
                                    {pendingBids.map((b) => (
                                        <div key={b.id} className="card spotBookingCard">
                                            <div className="rowInline">
                                                <span className="badge">£{Number(b.amount_gbp).toFixed(2)}</span>
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
                            ) : isOwner ? (
                                <div className="muted tiny">No bids yet.</div>
                            ) : null}
                        </div>
                    ) : (
                        bookingPanel
                    )}
                    {spot.mode === "auction" && (auctionMe?.status === "accepted" || auctionMe?.status === "won") && (
                        <div className="spotAlert" style={{ marginTop: 12 }}>
                            Your bid was accepted. Your booking is confirmed for the selected time slot.{" "}
                            <Link to="/dashboard?tab=myBookings" style={{ textDecoration: "underline" }}>
                                View in dashboard
                            </Link>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
}

function priceUnitLabel(price: number) {
    return price > 0 ? "/hour" : "";
}

function formatAvailability(spot: ParkingSpot) {
    const a = spot.availability_json;
    const dateRange = a?.date_from || a?.date_to
        ? ` (${a?.date_from ?? "…"} to ${a?.date_to ?? "…"})`
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

function extractAvailabilityRules(spot: ParkingSpot) {
    const rules: Array<{ dow: number; start: string; end: string }> = [];

    const a = spot.availability_json;
    if (a?.type === "24_7") {
        return Array.from({ length: 7 }).map((_, dow) => ({ dow, start: "00:00", end: "23:59" }));
    }
    if (a?.type === "same_everyday" && a.start && a.end) {
        return Array.from({ length: 7 }).map((_, dow) => ({ dow, start: a.start, end: a.end }));
    }
    if (a?.type === "custom_weekly" && Array.isArray(a.rules)) {
        return a.rules.slice();
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
        return d.toLocaleString();
    } catch {
        return `${localDateStr(d)} ${localTimeStr(d)}`;
    }
}

function roundToNextQuarter(d: Date) {
    const out = new Date(d);
    const minutes = out.getMinutes();
    const rounded = Math.ceil(minutes / 15) * 15;
    out.setMinutes(rounded, 0, 0);
    return out;
}

function formatWindow(start: Date, end: Date) {
    return `${dowLabel(start.getDay())} ${localDateStr(start)} ${localTimeStr(start)}–${localTimeStr(end)}`;
}

function formatSlotLabel(start: Date, minutes: number) {
    const end = addMinutes(start, minutes);
    return `${dowLabel(start.getDay())} ${localTimeStr(start)}–${localTimeStr(end)}`;
}

function formatBidWindow(start?: string, end?: string) {
    if (!start || !end) return "Time not set";
    return `${formatLocalDateTime(new Date(start))} → ${formatLocalDateTime(new Date(end))}`;
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
    const windows = buildAvailabilityWindows(spot, 30);
    const now = new Date();
    const normalized = bookings
        .filter((b) => b.start_time && b.end_time)
        .map((b) => ({ start: new Date(b.start_time as string), end: new Date(b.end_time as string) }))
        .sort((a, b) => a.start.getTime() - b.start.getTime());

    for (const w of windows) {
        const segments = subtractBookings(w, normalized);
        for (const seg of segments) {
            let start = seg.start;
            if (start < now) start = roundToNextQuarter(now);
            if (start < seg.end) return { start, end: seg.end };
        }
    }
    return null;
}

function getNextSlots(spot: ParkingSpot, bookings: Booking[], minutes: number, count = 3) {
    const windows = buildAvailabilityWindows(spot, 30);
    const now = new Date();
    const normalized = bookings
        .filter((b) => b.start_time && b.end_time)
        .map((b) => ({ start: new Date(b.start_time as string), end: new Date(b.end_time as string) }))
        .sort((a, b) => a.start.getTime() - b.start.getTime());

    const results: Date[] = [];
    for (const w of windows) {
        const segments = subtractBookings(w, normalized);
        for (const seg of segments) {
            let cursor = seg.start < now ? roundToNextQuarter(now) : seg.start;
            while (addMinutes(cursor, minutes) <= seg.end) {
                results.push(new Date(cursor));
                if (results.length >= count) return results;
                cursor = addMinutes(cursor, 15);
            }
        }
    }
    return results;
}

function getNextNonOverlappingSlots(spot: ParkingSpot, bookings: Booking[], minutes: number, count = 4) {
    const candidates = getNextSlots(spot, bookings, minutes, Math.max(count * 4, 12));
    const results: Date[] = [];
    let lastEnd: Date | null = null;
    for (const c of candidates) {
        if (!lastEnd || c >= lastEnd) {
            results.push(c);
            lastEnd = addMinutes(c, minutes);
        }
        if (results.length >= count) break;
    }
    return results;
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
    bookings: Array<{ start: Date; end: Date }>
) {
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
