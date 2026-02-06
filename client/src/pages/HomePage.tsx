import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { apiGet } from "../lib/api";
import type { ParkingSpot } from "../types";
import SpotsMap from "../components/SpotsMap";
import logoImg from "../assets/logo.png";

type UserLoc = { lat: number; lng: number } | null;
type SortMode = "recommended" | "distance" | "price_low" | "price_high";
type ViewMode = "split" | "list" | "map";

type Booking = {
    id: string;
    parking_spot_id: string;
    start_time: string;
    end_time: string;
    status: string;
};

function toMoney(x: any) {
    const n = Number(x ?? 0);
    return Number.isFinite(n) ? n : 0;
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
    const R = 6371;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLon = ((b.lng - a.lng) * Math.PI) / 180;
    const la1 = (a.lat * Math.PI) / 180;
    const la2 = (b.lat * Math.PI) / 180;
    const x =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
}

function clamp01(x: number) {
    return Math.max(0, Math.min(1, x));
}

function availabilityLabel(spot: ParkingSpot) {
    const rules = extractAvailabilityRules(spot);
    if (!rules.length) return "Limited";

    const isAllDay = isExplicitAllDay(spot, rules);
    if (isAllDay) return "24/7";

    const today = new Date().getDay();
    const todaysRules = rules.filter((r) => r.dow === today);
    return todaysRules.length ? "Available today" : "Limited";
}

function estimateTotalForDuration(spot: ParkingSpot, durationMinutes: number) {
    const unit = (spot as any).price_unit ?? "hour";
    const price = toMoney((spot as any).price_gbp);
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return 0;
    if (spot.mode === "auction") return 0;
    if (spot.mode === "free" || price <= 0) return 0;

    const minutes = durationMinutes;
    if (unit === "hour") {
        const roundedMinutes = Math.max(5, Math.ceil(minutes / 5) * 5);
        const units = roundedMinutes / 60;
        return price * units;
    }
    if (unit === "day") {
        const units = Math.max(1, Math.ceil(minutes / (60 * 24)));
        return price * units;
    }
    if (unit === "week") {
        const units = Math.max(1, Math.ceil(minutes / (60 * 24 * 7)));
        return price * units;
    }
    return price;
}

export default function HomePage() {
    const location = useLocation();
    const [spots, setSpots] = useState<ParkingSpot[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // UI state
    const [q, setQ] = useState("");
    const [sort, setSort] = useState<SortMode>("recommended");
    const [maxPrice, setMaxPrice] = useState<number>(0);
    const [onlyFree, setOnlyFree] = useState(false);
    const [modes, setModes] = useState<{ free: boolean; rent: boolean; auction: boolean }>({
        free: true,
        rent: true,
        auction: true,
    });
    const [viewMode, setViewMode] = useState<ViewMode>("split");
    const [sortOpen, setSortOpen] = useState(false);
    const [timeFilterOpen, setTimeFilterOpen] = useState(false);
    const [viewOpen, setViewOpen] = useState(false);
    const [desiredDate, setDesiredDate] = useState("");
    const [desiredTime, setDesiredTime] = useState("");
    const [desiredDuration, setDesiredDuration] = useState(60);

    // Applied filters (only update when user presses Search)
    const [appliedQ, setAppliedQ] = useState("");
    const [appliedSort, setAppliedSort] = useState<SortMode>("recommended");
    const [appliedMaxPrice, setAppliedMaxPrice] = useState<number>(0);
    const [appliedOnlyFree, setAppliedOnlyFree] = useState(false);
    const [appliedModes, setAppliedModes] = useState<{ free: boolean; rent: boolean; auction: boolean }>({
        free: true,
        rent: true,
        auction: true,
    });
    const [appliedDate, setAppliedDate] = useState("");
    const [appliedTime, setAppliedTime] = useState("");
    const [appliedDuration, setAppliedDuration] = useState(60);

    const [userLoc, setUserLoc] = useState<UserLoc>(null);
    const [locStatus, setLocStatus] = useState<string | null>(null);

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [bookingCounts, setBookingCounts] = useState<Record<string, number>>({});
    const [bookingWindows, setBookingWindows] = useState<Record<string, Booking[]>>({});

    useEffect(() => {
        (async () => {
            try {
                const r = await apiGet<{ parking_spots: ParkingSpot[] }>("/parking-spots");
                setSpots(r.parking_spots ?? []);
            } catch (e) {
                setError(e instanceof Error ? e.message : "Failed to load spots");
            } finally {
                setLoading(false);
            }
        })();
    }, [location.state]);

    function requestLocation() {
        setLocStatus(null);

        if (!("geolocation" in navigator)) {
            setLocStatus("Your browser doesn't support location.");
            return;
        }

        setLocStatus("Getting your location…");
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
                setLocStatus("Using your location.");
            },
            () => setLocStatus("Location blocked. You can still search and browse.")
        );
    }

    function resetFilters() {
        setQ("");
        setSort("recommended");
        setMaxPrice(0);
        setOnlyFree(false);
        setModes({ free: true, rent: true, auction: true });
        setDesiredDate("");
        setDesiredTime("");
        setDesiredDuration(60);

        setAppliedQ("");
        setAppliedSort("recommended");
        setAppliedMaxPrice(0);
        setAppliedOnlyFree(false);
        setAppliedModes({ free: true, rent: true, auction: true });
        setAppliedDate("");
        setAppliedTime("");
        setAppliedDuration(60);

        setSortOpen(false);
        setTimeFilterOpen(false);
    }

    useEffect(() => {
        const handle = setTimeout(() => {
            setAppliedQ(q);
        }, 250);
        return () => clearTimeout(handle);
    }, [q]);

    useEffect(() => {
        setAppliedSort(sort);
        setAppliedMaxPrice(maxPrice);
        setAppliedOnlyFree(onlyFree);
        setAppliedModes(modes);
        setAppliedDate(desiredDate);
        setAppliedTime(desiredTime);
        setAppliedDuration(desiredDuration);
    }, [sort, maxPrice, onlyFree, modes, desiredDate, desiredTime, desiredDuration]);


    const filtered = useMemo(() => {
        const query = appliedQ.trim().toLowerCase();

        return spots.filter((s) => {
            const modeOk = (appliedModes as any)[s.mode] === true;
            if (!modeOk) return false;

            const price = toMoney((s as any).price_gbp);
            if (appliedOnlyFree && price > 0) return false;
            if (!appliedOnlyFree && appliedMaxPrice > 0 && price > appliedMaxPrice && s.mode !== "auction") return false;

            if (!query) return true;

            const hay = `${s.title ?? ""} ${s.address_text ?? ""} ${s.description ?? ""}`.toLowerCase();
            return hay.includes(query);
        });
    }, [spots, appliedQ, appliedModes, appliedMaxPrice, appliedOnlyFree]);

    const timeFiltered = useMemo(() => {
        if (!appliedDate || !appliedTime) return filtered;
        const start = new Date(`${appliedDate}T${appliedTime}`);
        if (Number.isNaN(start.getTime())) return filtered;
        const end = new Date(start.getTime() + appliedDuration * 60 * 1000);
        return filtered.filter((s) => isSpotAvailableFor(s, start, end));
    }, [filtered, appliedDate, appliedTime, appliedDuration]);

    useEffect(() => {
        if (!timeFiltered.length) {
            setBookingCounts({});
            setBookingWindows({});
            return;
        }
        const ids = timeFiltered.map((s) => s.id).join(",");
        const start = appliedDate && appliedTime ? new Date(`${appliedDate}T${appliedTime}`).toISOString() : "";
        const end =
            appliedDate && appliedTime
                ? new Date(new Date(`${appliedDate}T${appliedTime}`).getTime() + appliedDuration * 60 * 1000).toISOString()
                : "";

        const qs = start && end ? `?ids=${encodeURIComponent(ids)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
            : `?ids=${encodeURIComponent(ids)}`;

        apiGet<{ counts: Record<string, number> }>(`/bookings/availability${qs}`)
            .then((r) => setBookingCounts(r.counts ?? {}))
            .catch(() => setBookingCounts({}));
    }, [timeFiltered, appliedDate, appliedTime, appliedDuration]);

    useEffect(() => {
        if (!timeFiltered.length) {
            setBookingWindows({});
            return;
        }
        const ids = timeFiltered.map((s) => s.id).join(",");
        const now = new Date();
        const start = now.toISOString();
        const end = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
        const qs = `?ids=${encodeURIComponent(ids)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
        apiGet<{ bookings: Record<string, Booking[]> }>(`/bookings/window${qs}`)
            .then((r) => setBookingWindows(r.bookings ?? {}))
            .catch(() => setBookingWindows({}));
    }, [timeFiltered]);

    const enriched = useMemo(() => {
        const anchor =
            userLoc ??
            (timeFiltered[0]
                ? { lat: timeFiltered[0].lat, lng: timeFiltered[0].lng }
                : { lat: 51.5074, lng: -0.1278 });

        const prices = timeFiltered
            .filter((s) => s.mode !== "auction")
            .map((s) => toMoney((s as any).price_gbp))
            .filter((p) => p >= 0);

        const pMin = prices.length ? Math.min(...prices) : 0;
        const pMax = prices.length ? Math.max(...prices) : 30;

        return timeFiltered.map((s) => {
            const distKm = userLoc
                ? haversineKm(userLoc, { lat: s.lat, lng: s.lng })
                : haversineKm(anchor, { lat: s.lat, lng: s.lng });

            const price = toMoney((s as any).price_gbp);
            const availLabel = availabilityLabel(s);
            const avail =
                availLabel === "24/7"
                    ? 1
                    : availLabel === "Available today"
                        ? 0.8
                        : 0.3;

            const distScore = 1 / (1 + distKm / 5);
            const priceNorm = s.mode === "auction" ? 0.2 : pMax === pMin ? 0.5 : clamp01(1 - (price - pMin) / (pMax - pMin));

            const modeBoost = s.mode === "free" ? 0.12 : 0;
            const auctionPenalty = s.mode === "auction" ? -0.35 : 0;

            const distanceWeighted =
                distScore * 0.7 +
                avail * 0.2 +
                priceNorm * 0.1 +
                modeBoost +
                auctionPenalty;

            const distancePenalty =
                distKm > 200 ? 0.25
                    : distKm > 100 ? 0.5
                        : 1;

            const recommended = distanceWeighted * distancePenalty;

            const estimatedTotal = estimateTotalForDuration(s, appliedDuration);
            return { spot: s, distKm, price, availLabel, recommended, estimatedTotal };
        });
    }, [timeFiltered, userLoc, appliedDuration]);

    const sorted = useMemo(() => {
        const arr = enriched.slice();
        arr.sort((a, b) => {
            if (appliedSort === "distance") return a.distKm - b.distKm;
            if (appliedSort === "price_low") return a.price - b.price;
            if (appliedSort === "price_high") return b.price - a.price;
            return b.recommended - a.recommended;
        });
        return arr;
    }, [enriched, appliedSort]);

    const timeFilteredByBookings = useMemo(() => {
        if (!appliedDate || !appliedTime) return sorted;
        const start = new Date(`${appliedDate}T${appliedTime}`);
        if (Number.isNaN(start.getTime())) return sorted;

        return sorted.filter(({ spot }) => {
            const count = bookingCounts[spot.id] ?? 0;
            const capacity = Number((spot as any).capacity_total ?? 1);
            const isPublic = (spot as any).parking_type === "public";

            if (isPublic) {
                return count < Math.max(1, capacity);
            }
            return count === 0;
        });
    }, [sorted, appliedDate, appliedTime, bookingCounts]);

    const mapCenter = useMemo(() => {
        if (userLoc) return userLoc;
        if (selectedId) {
            const hit = timeFilteredByBookings.find((x) => x.spot.id === selectedId);
            if (hit) return { lat: hit.spot.lat, lng: hit.spot.lng };
        }
        if (timeFilteredByBookings.length) return { lat: timeFilteredByBookings[0].spot.lat, lng: timeFilteredByBookings[0].spot.lng };
        return { lat: 51.5074, lng: -0.1278 };
    }, [userLoc, timeFilteredByBookings, selectedId]);

    const viewToggle = (
        <div style={{ position: "relative" }}>
            <button type="button" className="btn" onClick={() => setViewOpen((v) => !v)}>
                Toggle view {viewOpen ? "▴" : "▾"}
            </button>
            {viewOpen && (
                <div className="card sortCard" style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 5 }}>
                    <div className="stack">
                        <button
                            type="button"
                            className={`btn ${viewMode === "split" ? "btn-primary" : ""}`}
                            onClick={() => {
                                setViewMode("split");
                                setViewOpen(false);
                            }}
                        >
                            Split view
                        </button>
                        <button
                            type="button"
                            className={`btn ${viewMode === "list" ? "btn-primary" : ""}`}
                            onClick={() => {
                                setViewMode("list");
                                setViewOpen(false);
                            }}
                        >
                            List view
                        </button>
                        <button
                            type="button"
                            className={`btn ${viewMode === "map" ? "btn-primary" : ""}`}
                            onClick={() => {
                                setViewMode("map");
                                setViewOpen(false);
                            }}
                        >
                            Map view
                        </button>
                    </div>
                </div>
            )}
        </div>
    );

    return (
        <div className={`home home--${viewMode}`}>
            {/* LEFT */}
            {viewMode !== "map" && (
                <aside className="sidebar">
                {/* Makes the WHOLE left column scrollable */}
                <div className="sidebarScroll">
                    {/* HERO */}
           

                    {/* CONTROLS */}
                    <div className="card sidebarControls">
                        <div className="rowInline" style={{ alignItems: "flex-end" }}>
                            <label style={{ flex: 1 }}>
                                <span>Search</span>
                                <input
                                    className="input"
                                    value={q}
                                    onChange={(e) => setQ(e.target.value)}
                                    placeholder="Try: Upper Street, garage, cheap…"
                                />
                            </label>
                            <button className="btn btn-primary" onClick={requestLocation} type="button">
                                Use my location
                            </button>
                        </div>
                        <div className="tiny muted">{locStatus ?? (userLoc ? "Location active." : "Location off.")}</div>
                        <div className="rowInline">
                            <button type="button" className="btn" onClick={() => setSortOpen((p) => !p)}>
                                Sort {sortOpen ? "▴" : "▾"}
                            </button>
                            <button type="button" className="btn" onClick={() => setTimeFilterOpen((p) => !p)}>
                                Time filter {timeFilterOpen ? "▴" : "▾"}
                            </button>
                            <button type="button" className="btn" onClick={resetFilters}>
                                Reset
                            </button>
                            {viewToggle}
                        </div>

                        {sortOpen && (
                            <div className="card sortCard" style={{ background: "rgba(255,255,255,0.02)" }}>
                                <div className="row">
                                    <label>
                                        <span>Sort</span>
                                        <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
                                            <option value="recommended">Recommended</option>
                                            <option value="distance">Closest</option>
                                            <option value="price_low">Cheapest</option>
                                            <option value="price_high">Most expensive</option>
                                        </select>
                                    </label>

                                    <label>
                                        <span>Max price (rent)</span>
                                        <input
                                            className="input"
                                            type="number"
                                            min={0}
                                            step={1}
                                            value={maxPrice}
                                            onChange={(e) => setMaxPrice(Number(e.target.value))}
                                        />
                                    </label>
                                </div>

                                <div className="chips">
                                    <label className="chip">
                                        <input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)} />
                                        Free only
                                    </label>

                                    <label className="chip">
                                        <input
                                            type="checkbox"
                                            checked={modes.free}
                                            onChange={(e) => setModes((p) => ({ ...p, free: e.target.checked }))}
                                        />
                                        Free
                                    </label>

                                    <label className="chip">
                                        <input
                                            type="checkbox"
                                            checked={modes.rent}
                                            onChange={(e) => setModes((p) => ({ ...p, rent: e.target.checked }))}
                                        />
                                        Rent
                                    </label>

                                    <label className="chip">
                                        <input
                                            type="checkbox"
                                            checked={modes.auction}
                                            onChange={(e) => setModes((p) => ({ ...p, auction: e.target.checked }))}
                                        />
                                        Auction
                                    </label>
                                </div>
                            </div>
                        )}

                        {timeFilterOpen && (
                            <div className="card timeFilterCard" style={{ background: "rgba(255,255,255,0.02)" }}>
                                <div className="row" style={{ marginTop: 8 }}>
                                    <label>
                                        <span>Date</span>
                                        <input
                                            className="input"
                                            type="date"
                                            value={desiredDate}
                                            onChange={(e) => setDesiredDate(e.target.value)}
                                            disabled={!timeFilterOpen}
                                        />
                                    </label>
                                    <label>
                                        <span>Time</span>
                                        <input
                                            className="input"
                                            type="time"
                                            value={desiredTime}
                                            onChange={(e) => setDesiredTime(e.target.value)}
                                            disabled={!timeFilterOpen}
                                        />
                                    </label>
                                </div>
                                <label>
                                    <span>Duration</span>
                                    <select
                                        value={desiredDuration}
                                        onChange={(e) => setDesiredDuration(Number(e.target.value))}
                                        disabled={!timeFilterOpen}
                                    >
                                        <option value={15}>15 minutes</option>
                                        <option value={30}>30 minutes</option>
                                        <option value={45}>45 minutes</option>
                                        <option value={60}>1 hour</option>
                                        <option value={90}>1 hour 30 minutes</option>
                                        <option value={120}>2 hours</option>
                                        <option value={180}>3 hours</option>
                                    </select>
                                </label>
                            </div>
                        )}

                        <div className="tiny muted">
                            {loading ? "Loading…" : error ? "Error loading spots." : `${timeFilteredByBookings.length} spot${timeFilteredByBookings.length === 1 ? "" : "s"} found`}
                            {" · "}
                            {userLoc ? "sorted based on your current location" : "enable location for better results"}
                        </div>
                    </div>

                    {/* RESULTS */}
                    <div className="results">
                        {loading && <div className="card" style={{ padding: 12 }}>Loading parking spots…</div>}
                        {error && (
                            <div className="card" style={{ padding: 12, borderColor: "rgba(255,80,80,0.35)" }}>
                                {error}
                            </div>
                        )}

                        {!loading && !error && timeFilteredByBookings.length === 0 && (
                            <div className="card" style={{ padding: 12 }}>
                                <div className="h3">No results</div>
                                <div className="muted" style={{ marginTop: 6 }}>
                                    Try a different search, increase max price, or enable more modes.
                                </div>
                            </div>
                        )}

                        {!loading && !error && timeFilteredByBookings.map(({ spot, distKm, price, availLabel, recommended, estimatedTotal }) => {
                            const active = spot.id === selectedId;

                            const highestPending = Number((spot as any).auction_highest_pending_gbp ?? 0);
                            const startPrice = Number((spot as any).auction_start_price_gbp ?? 0);
                            const auctionPriceLabel = highestPending > 0
                                ? `Bid £${highestPending.toFixed(2)}`
                                : `Start £${startPrice.toFixed(2)}`;

                            const pill =
                                spot.mode === "free" ? "Free"
                                    : spot.mode === "rent" ? `£${price.toFixed(2)}`
                                        : auctionPriceLabel;
                            const nextWindow = getNextAvailableWindow(spot, bookingWindows[spot.id] ?? []);

                            const bookedCount = bookingCounts[spot.id] ?? 0;
                            const capacity = Number((spot as any).capacity_total ?? 1);
                            const fullyBooked = bookedCount >= Math.max(1, capacity);
                            const auctionSoldOut = Boolean((spot as any).auction_sold_out);

                            return (
                                <button
                                    key={spot.id}
                                    type="button"
                                    className={`resultCard ${active ? "active" : ""}`}
                                    onClick={() => setSelectedId(spot.id)}
                                >
                                    <div className="resultTop">
                                        <div className="resultLeft">
                                            <div className="thumb">
                                                {spot.image_url ? (
                                                    <img src={spot.image_url} alt={spot.title} loading="lazy" />
                                                ) : (
                                                    <img className="thumbLogo" src={logoImg} alt="ParkingBuddies logo" />
                                                )}
                                            </div>

                                            <div className="resultText">
                                                <div className="resultTitle">{spot.title}</div>
                                                <div className="muted tiny" style={{ marginTop: 6 }}>
                                                    {spot.address_text}
                                                </div>
                                            </div>
                                        </div>
                                        <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
                                            <div className="pill pill--price">
                                                {pill}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="meta">
                                        <span className="badge">{spot.mode}</span>
                                        <span className="badge">{availLabel}</span>
                                        <span className="badge">{userLoc ? `${distKm.toFixed(1)} km` : "Enable location"}</span>
                                        {fullyBooked && <span className="badge badge--rose">Fully booked</span>}
                                        {spot.mode === "auction" && auctionSoldOut && (
                                            <span className="badge badge--rose">Sold out</span>
                                        )}
                                        {(spot as any).parking_type === "public" && (
                                            <span className="badge badge--cool">
                                                {(spot as any).capacity_available ?? 0}/{(spot as any).capacity_total ?? 0} spaces
                                            </span>
                                        )}
                                        <span className="badge">Score {Math.round(recommended * 100)}</span>
                                        {appliedDate && appliedTime && spot.mode !== "auction" && (
                                            <span className="badge">
                                                Est. £{estimatedTotal.toFixed(2)}
                                            </span>
                                        )}
                                    </div>

                                    {nextWindow && (
                                        <div className="tiny muted" style={{ marginTop: 6 }}>
                                            Next available: {formatWindow(nextWindow.start, nextWindow.end)}
                                        </div>
                                    )}

                                    <div className="resultFooter" style={{ justifyContent: "space-between", gap: 12 }}>
                                        <div className="rowInline" style={{ alignItems: "center", gap: 8 }}>
                                            <Link
                                                className="btn btn-accent"
                                                to={
                                                    appliedDate && appliedTime
                                                        ? `/spots/${spot.id}?date=${encodeURIComponent(appliedDate)}&time=${encodeURIComponent(appliedTime)}&duration=${encodeURIComponent(String(appliedDuration))}`
                                                        : `/spots/${spot.id}`
                                                }
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                View details
                                            </Link>
                                            {(spot as any).allow_points && Number((spot as any).points_cost ?? 0) > 0 && (
                                                <span className="badge badge--rose">Available with points</span>
                                            )}
                                        </div>
                                        <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
                                            {(spot as any).allow_points && Number((spot as any).points_cost ?? 0) > 0 && (
                                                <div className="pill pill--price" style={{ background: "transparent", border: "none", padding: 0 }}>
                                                    {(spot as any).points_cost} points
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </aside>
            )}

            {/* RIGHT */}
            {viewMode !== "list" && (
                <main className={`mapWrap ${viewMode === "map" ? "mapWrap--withTopBar" : ""}`}>
                {viewMode === "map" && (
                    <div className="mapTopBar">
                        <div className="rowInline" style={{ alignItems: "flex-end" }}>
                            <label style={{ flex: 1 }}>
                                <span>Search</span>
                                <input
                                    className="input"
                                    value={q}
                                    onChange={(e) => setQ(e.target.value)}
                                    placeholder="Try: Upper Street, garage, cheap…"
                                />
                            </label>
                            <button className="btn btn-primary" onClick={requestLocation} type="button">
                                Use my location
                            </button>
                        </div>
                        <div className="tiny muted">{locStatus ?? (userLoc ? "Location active." : "Location off.")}</div>
                        <div className="rowInline" style={{ justifyContent: "space-between" }}>
                            <div className="rowInline">
                                <button type="button" className="btn" onClick={() => setSortOpen((p) => !p)}>
                                    Sort {sortOpen ? "▴" : "▾"}
                                </button>
                                <button type="button" className="btn" onClick={() => setTimeFilterOpen((p) => !p)}>
                                    Time filter {timeFilterOpen ? "▴" : "▾"}
                                </button>
                                <button type="button" className="btn" onClick={resetFilters}>
                                    Reset
                                </button>
                            </div>
                            {viewToggle}
                        </div>
                    </div>
                )}
                <SpotsMap
                    spots={timeFilteredByBookings.map((x) => x.spot)}
                    center={mapCenter}
                    selectedId={selectedId}
                    onSelect={(id) => setSelectedId(id)}
                />
            </main>
            )}
        </div>
    );
}

function extractAvailabilityRules(spot: ParkingSpot) {
    const rules: Array<{ dow: number; start: string; end: string }> = [];
    const a: any = (spot as any).availability_json;

    if (a?.type === "24_7") {
        return Array.from({ length: 7 }).map((_, dow) => ({ dow, start: "00:00", end: "23:59" }));
    }
    if (a?.type === "same_everyday" && a.start && a.end) {
        return Array.from({ length: 7 }).map((_, dow) => ({ dow, start: a.start, end: a.end }));
    }
    if (a?.type === "custom_weekly" && Array.isArray(a.rules)) {
        return a.rules.slice();
    }

    if ((spot as any).availability_type === "24_7") {
        return Array.from({ length: 7 }).map((_, dow) => ({ dow, start: "00:00", end: "23:59" }));
    }
    if ((spot as any).availability_type === "weekly" && Array.isArray((spot as any).available_days)) {
        const ds = (spot as any).daily_start?.slice(0, 5) ?? "00:00";
        const de = (spot as any).daily_end?.slice(0, 5) ?? "23:59";
        return (spot as any).available_days.map((dow: number) => ({ dow, start: ds, end: de }));
    }

    return rules;
}

function isExplicitAllDay(
    spot: ParkingSpot,
    rules: Array<{ dow: number; start: string; end: string }>
) {
    const a: any = (spot as any).availability_json;
    if (a?.type === "24_7") return true;
    if (a?.type === "same_everyday" && a.start && a.end) {
        return a.start === "00:00" && a.end === "23:59";
    }
    if (a?.type === "custom_weekly" && Array.isArray(a.rules)) {
        return rules.length === 7 && rules.every((r) => r.start === "00:00" && r.end === "23:59");
    }

    if ((spot as any).availability_type === "24_7") return true;
    if ((spot as any).availability_type === "weekly") {
        const ds = (spot as any).daily_start?.slice(0, 5);
        const de = (spot as any).daily_end?.slice(0, 5);
        const days = (spot as any).available_days;
        if (Array.isArray(days) && days.length === 7 && ds && de) {
            return ds === "00:00" && de === "23:59";
        }
    }

    return false;
}

function setTime(d: Date, hhmm: string) {
    const [h, m] = hhmm.split(":").map((x) => Number(x));
    const out = new Date(d);
    out.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
    return out;
}

function isSpotAvailableFor(spot: ParkingSpot, start: Date, end: Date) {
    if (!(start < end)) return false;

    const rules = extractAvailabilityRules(spot);
    if (!rules.length) return true;

    const a: any = (spot as any).availability_json;
    const dateFrom = a?.date_from ? new Date(`${a.date_from}T00:00:00`) : null;
    const dateTo = a?.date_to ? new Date(`${a.date_to}T23:59:59`) : null;
    if (dateFrom && start < dateFrom) return false;
    if (dateTo && end > dateTo) return false;

    const dow = start.getDay();
    const dayRules = rules.filter((r) => r.dow === dow);
    if (!dayRules.length) return false;

    const isAllDay =
        rules.length === 7 &&
        rules.every((r) => r.start === "00:00" && r.end === "23:59");

    if (isAllDay) {
        return true;
    }

    if (start.toDateString() !== end.toDateString()) return false;

    for (const r of dayRules) {
        const ruleStart = setTime(start, r.start);
        const ruleEnd = setTime(start, r.end);
        if (start >= ruleStart && end <= ruleEnd) return true;
    }
    return false;
}

function roundToNextQuarter(d: Date) {
    const out = new Date(d);
    const minutes = out.getMinutes();
    const rounded = Math.ceil(minutes / 15) * 15;
    out.setMinutes(rounded, 0, 0);
    return out;
}

function formatWindow(start: Date, end: Date) {
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][start.getDay()] ?? "Day";
    const pad = (n: number) => String(n).padStart(2, "0");
    const date = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
    const t1 = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
    const t2 = `${pad(end.getHours())}:${pad(end.getMinutes())}`;
    return `${day} ${date} ${t1}-${t2}`;
}

function getNextAvailableWindow(spot: ParkingSpot, bookings: Booking[]) {
    const windows = buildAvailabilityWindows(spot, 14);
    const now = new Date();
    const normalized = bookings
        .filter((b) => b.start_time && b.end_time)
        .map((b) => ({ start: new Date(b.start_time), end: new Date(b.end_time) }))
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

function buildAvailabilityWindows(spot: ParkingSpot, daysForward: number) {
    const rules = extractAvailabilityRules(spot);
    if (!rules.length) return [];

    const a: any = (spot as any).availability_json;
    const dateFrom = a?.date_from ? new Date(`${a.date_from}T00:00:00`) : null;
    const dateTo = a?.date_to ? new Date(`${a.date_to}T23:59:59`) : null;

    const now = new Date();
    const windows: Array<{ start: Date; end: Date }> = [];
    for (let i = 0; i <= daysForward; i += 1) {
        const day = new Date(now);
        day.setDate(day.getDate() + i);
        day.setHours(0, 0, 0, 0);

        if (dateFrom && day < dateFrom) continue;
        if (dateTo && day > dateTo) continue;

        const dow = day.getDay();
        const dayRules = rules.filter((r) => r.dow === dow);
        for (const r of dayRules) {
            const start = setTime(day, r.start);
            const end = setTime(day, r.end);
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
