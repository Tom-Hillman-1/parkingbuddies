import { useEffect, useMemo, useRef, useState } from "react";
import Lottie from "lottie-react";
import { Link } from "react-router-dom";
import SpotsMap from "../components/SpotsMap";
import { apiGet } from "../lib/api";
import type { ParkingSpot } from "../types";
import { capitalizeLabel, toFiniteNumber } from "./pagesShared";

type SortMode = "distance" | "price_low" | "price_high";
type ModeFilter = Record<ParkingSpot["mode"], boolean>;

const LONDON = { lat: 51.5074, lng: -0.1278 };
const HOME_HERO_BACKGROUND_URL = new URL("../assets/loading_hero.json", import.meta.url).href;
const HOME_HERO_CITY_URL = new URL("../assets/city.json", import.meta.url).href;

function priceValue(spot: ParkingSpot) {
    if (spot.mode === "free") return 0;
    return Math.max(0, toFiniteNumber(spot.price_gbp));
}

function priceLabel(spot: ParkingSpot) {
    const price = priceValue(spot);
    const unit = String(spot.price_unit ?? "hour");
    const points = Math.max(0, toFiniteNumber(spot.points_cost));
    const pointsText = Number.isInteger(points) ? points.toFixed(0) : points.toFixed(1);
    const pointsLabel = spot.allow_points && points > 0 ? `${pointsText} pts` : null;
    let main = "";

    if (spot.mode === "auction") {
        main = `Bid from \u00A3${price.toFixed(2)}`;
    } else if (price <= 0) {
        main = "Free";
    } else {
        main = `\u00A3${price.toFixed(2)} / ${unit}`;
    }

    return { main, pointsLabel };
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
    const earthKm = 6371;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const lat1 = (a.lat * Math.PI) / 180;
    const lat2 = (b.lat * Math.PI) / 180;

    const x =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

    return 2 * earthKm * Math.asin(Math.sqrt(x));
}

export default function HomePage() {
    const [spots, setSpots] = useState<ParkingSpot[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [heroBackgroundAnimationData, setHeroBackgroundAnimationData] = useState<Record<string, unknown> | null>(null);
    const [heroCityAnimationData, setHeroCityAnimationData] = useState<Record<string, unknown> | null>(null);

    const [query, setQuery] = useState("");
    const [sort, setSort] = useState<SortMode>("distance");
    const [modeFilter, setModeFilter] = useState<ModeFilter>({ free: true, rent: true, auction: true });
    const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);
    const [locStatus, setLocStatus] = useState<string | null>(null);

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [hoveredId, setHoveredId] = useState<string | null>(null);

    const spotsRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        let active = true;

        async function load() {
            setLoading(true);
            setError(null);
            try {
                const result = await apiGet<{ parking_spots: ParkingSpot[] }>("/parking-spots");
                if (active) setSpots(result.parking_spots ?? []);
            } catch (err) {
                if (active) setError(err instanceof Error ? err.message : "Failed to load parking spots.");
            } finally {
                if (active) setLoading(false);
            }
        }

        load();
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        let active = true;

        fetch(HOME_HERO_BACKGROUND_URL)
            .then((response) => {
                if (!response.ok) throw new Error("Background animation file failed to load.");
                return response.json();
            })
            .then((json) => {
                if (active) setHeroBackgroundAnimationData(json);
            })
            .catch(() => {
                if (active) setHeroBackgroundAnimationData(null);
            });

        fetch(HOME_HERO_CITY_URL)
            .then((response) => {
                if (!response.ok) throw new Error("City animation file failed to load.");
                return response.json();
            })
            .then((json) => {
                if (active) setHeroCityAnimationData(json);
            })
            .catch(() => {
                if (active) setHeroCityAnimationData(null);
            });

        return () => {
            active = false;
        };
    }, []);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();

        return spots.filter((spot) => {
            if (!modeFilter[spot.mode]) return false;
            if (!q) return true;
            const searchable = `${spot.title} ${spot.address_text} ${spot.description}`.toLowerCase();
            return searchable.includes(q);
        });
    }, [spots, query, modeFilter]);

    const anchor = useMemo(() => {
        if (userLoc) return userLoc;
        if (filtered[0]) return { lat: filtered[0].lat, lng: filtered[0].lng };
        return LONDON;
    }, [filtered, userLoc]);

    const ranked = useMemo(() => {
        const rows = filtered.map((spot) => ({
            spot,
            distKm: haversineKm(anchor, { lat: spot.lat, lng: spot.lng }),
            price: priceValue(spot),
        }));

        rows.sort((a, b) => {
            if (sort === "distance") return a.distKm - b.distKm;
            if (sort === "price_low") return a.price - b.price;
            return b.price - a.price;
        });

        return rows;
    }, [filtered, anchor, sort]);

    const visible = ranked;
    const mapSpots = useMemo(() => ranked.map((entry) => entry.spot), [ranked]);

    useEffect(() => {
        if (!mapSpots.length) {
            setSelectedId(null);
            return;
        }

        if (!selectedId || !mapSpots.some((spot) => spot.id === selectedId)) {
            setSelectedId(mapSpots[0].id);
        }
    }, [mapSpots, selectedId]);

    const mapCenter = useMemo(() => {
        const selected = mapSpots.find((spot) => spot.id === selectedId);
        if (selected) return { lat: selected.lat, lng: selected.lng };
        if (mapSpots[0]) return { lat: mapSpots[0].lat, lng: mapSpots[0].lng };
        return LONDON;
    }, [mapSpots, selectedId]);

    const isLocEnabled = locStatus === "Location enabled.";
    const isLocPending = locStatus === "Enabling location...";
    const locationButtonTone =
        isLocEnabled ? "btn-loc-enabled"
        : locStatus === "Location was blocked." ? "btn-loc-blocked"
        : "btn-ghost";
    const locationButtonLabel =
        isLocEnabled ? "Location enabled"
        : isLocPending ? "Enabling..."
        : locStatus === "Location was blocked." ? "Location blocked"
        : locStatus === "Location is not supported on this browser." ? "Not supported"
        : "Enable location";

    function toggleMode(mode: ParkingSpot["mode"]) {
        setModeFilter((current) => ({ ...current, [mode]: !current[mode] }));
    }

    function resetFilters() {
        setQuery("");
        setSort("distance");
        setModeFilter({ free: true, rent: true, auction: true });
    }

    function requestLocation() {
        if (!("geolocation" in navigator)) {
            setLocStatus("Location is not supported on this browser.");
            return;
        }

        setLocStatus("Enabling location...");
        navigator.geolocation.getCurrentPosition(
            (position) => {
                setUserLoc({ lat: position.coords.latitude, lng: position.coords.longitude });
                setLocStatus("Location enabled.");
            },
            () => {
                setLocStatus("Location was blocked.");
            }
        );
    }

    function goToSpots() {
        spotsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function focusSpotOnMap(spotId: string, shouldScroll: boolean) {
        setSelectedId(spotId);
        setHoveredId(spotId);

        if (shouldScroll) {
            mapRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    }

    function isSmallLayout() {
        if (typeof window === "undefined") return false;
        return window.matchMedia("(max-width: 1040px)").matches;
    }

    return (
        <div className="home">
            <section className="home-hero container">
                <div className="home-hero-bg" aria-hidden="true">
                    {heroBackgroundAnimationData ? (
                        <Lottie
                            className="home-hero-bg-animation"
                            animationData={heroBackgroundAnimationData}
                            loop
                            autoplay
                        />
                    ) : null}
                </div>
                <p className="home-kicker">ParkingBuddies</p>
                <h1 className="home-title">Park on your own terms.</h1>
                <p className="home-copy">
                    Browse nearby spaces, compare options quickly, and book in seconds.
                </p>
                <div className="home-actions">
                    <Link to="/create-listing" className="btn btn-primary">List your spot</Link>
                    <button type="button" className="btn btn-ghost" onClick={goToSpots}>View spots</button>
                </div>
                {heroCityAnimationData ? (
                    <div className="home-hero-city" aria-hidden="true">
                        <Lottie
                            className="home-hero-city-animation"
                            animationData={heroCityAnimationData}
                            loop
                            autoplay
                        />
                    </div>
                ) : null}
            </section>

            <section className="home-content container">
                <aside className="home-left">
                    <div className="card home-controls">
                        <label className="field">
                            <span className="field-label">Search</span>
                            <div className="search-inline">
                                <input
                                    className="input input--search"
                                    value={query}
                                    onChange={(event) => setQuery(event.target.value)}
                                    placeholder="Search by area, street, or landmark"
                                />
                                <button
                                    type="button"
                                    className={`btn ${locationButtonTone}`}
                                    onClick={requestLocation}
                                    disabled={isLocPending}
                                >
                                    {locationButtonLabel}
                                </button>
                            </div>
                        </label>

                        <div className="control-grid control-grid--compact">
                            <label className="field home-sort-glass">
                                <span className="field-label">Sort</span>
                                <select
                                    className="input"
                                    value={sort}
                                    onChange={(event) => setSort(event.target.value as SortMode)}
                                >
                                    <option value="distance">Closest first</option>
                                    <option value="price_low">Price: low to high</option>
                                    <option value="price_high">Price: high to low</option>
                                </select>
                            </label>

                            <button type="button" className="btn btn-ghost" onClick={resetFilters}>Reset</button>
                        </div>

                        <div className="mode-toggle" role="group" aria-label="Filter by listing type">
                            {(["rent", "free", "auction"] as const).map((mode) => (
                                <button
                                    key={mode}
                                    type="button"
                                    className={`mode-toggle-btn${modeFilter[mode] ? " is-active" : ""}`}
                                    onClick={() => toggleMode(mode)}
                                >
                                    {capitalizeLabel(mode)}
                                </button>
                            ))}
                        </div>

                        <p className="tiny muted">
                            Showing {visible.length} spots
                            {ranked.length !== spots.length ? ` out of ${spots.length}` : ""}.
                        </p>
                    </div>

                    <div ref={spotsRef} className="result-grid" role="list" aria-label="Search results">
                        {loading && <div className="card">Loading parking spots...</div>}
                        {error && !loading && <div className="card">{error}</div>}
                        {!loading && !error && !visible.length && (
                            <div className="card">
                                <h3 className="h3">No results</h3>
                                <p className="muted">Try a broader search or reset your filters.</p>
                            </div>
                        )}

                        {!loading && !error && visible.map((entry) => {
                            const { spot, distKm } = entry;
                            const active = selectedId === spot.id;
                            const price = priceLabel(spot);

                            return (
                                <article
                                    key={spot.id}
                                    role="listitem"
                                    tabIndex={0}
                                    className={`spot-card spot-card--${spot.mode}${active ? " is-active" : ""}`}
                                    onFocus={() => setSelectedId(spot.id)}
                                    onMouseEnter={() => {
                                        setHoveredId(spot.id);
                                    }}
                                    onMouseLeave={() => setHoveredId((prev) => (prev === spot.id ? null : prev))}
                                    onClick={() => focusSpotOnMap(spot.id, isSmallLayout())}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter" || event.key === " ") {
                                            event.preventDefault();
                                            focusSpotOnMap(spot.id, isSmallLayout());
                                        }
                                    }}
                                >
                                    <div className="spot-head">
                                        <div className="spot-head-main">
                                            <h3 className="h3">{spot.title}</h3>
                                            <p className="spot-address" title={spot.address_text}>{spot.address_text}</p>
                                        </div>
                                        <span className={`spot-price${price.pointsLabel ? " spot-price--stacked" : ""}`}>
                                            <span className="spot-price-main">{price.main}</span>
                                            {price.pointsLabel && (
                                                <>
                                                    <span className="spot-price-or">or</span>
                                                    <span className="spot-price-points">{price.pointsLabel}</span>
                                                </>
                                            )}
                                        </span>
                                    </div>

                                    <div className="spot-divider" aria-hidden="true" />

                                    <div className="spot-foot">
                                        <div className="spot-meta">
                                            <span className="badge">{capitalizeLabel(spot.mode)}</span>
                                            <span className="badge">{distKm.toFixed(1)} km</span>
                                        </div>

                                        <div className="spot-actions">
                                            <Link
                                                to={`/spots/${spot.id}`}
                                                className="btn btn-primary"
                                                onClick={(event) => event.stopPropagation()}
                                            >
                                                View details
                                            </Link>
                                        </div>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                </aside>

                <section ref={mapRef} className="home-map card" aria-label="Map results">
                    <SpotsMap
                        spots={mapSpots}
                        center={mapCenter}
                        selectedId={selectedId}
                        hoveredId={hoveredId}
                        onSelect={(id) => setSelectedId(id)}
                        onHover={(id) => setHoveredId(id)}
                    />
                </section>
            </section>
        </div>
    );
}
