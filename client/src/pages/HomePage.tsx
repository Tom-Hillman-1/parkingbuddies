import { useEffect, useMemo, useRef, useState } from "react";
import Lottie from "lottie-react";
import { Link } from "react-router-dom";
import SpotsMap from "../components/SpotsMap";
import { apiGet } from "../lib/api";
import type { ParkingSpot } from "../types";
import { capitalizeLabel, toFiniteNumber } from "./pagesShared";
import {
    buildSearchWindow,
    formatSearchWindowSummary,
    type HomeSearchState,
} from "./homeSearchUtils";
import { HomeDatePickerDialog } from "./homeSearchSupport";
import {
    isSlotAllowed as isSpotSlotAllowed,
    nextWholeQuarterHour,
    normalizeTimeInput,
    toTimeInput,
} from "./spotDetailsSupport";

type SortMode = "distance" | "price_low" | "price_high" | "newest";
type ModeFilter = Record<ParkingSpot["mode"], boolean>;
type FilterSection = "when" | "price" | "type" | "sort";

const LONDON = { lat: 51.5074, lng: -0.1278 };
const HOME_HERO_BACKGROUND_URL = new URL("../assets/loading_hero.json", import.meta.url).href;
const HOME_HERO_CITY_URL = new URL("../assets/city.json", import.meta.url).href;
const DEFAULT_MODE_FILTER: ModeFilter = { free: true, rent: true, auction: true };
const HOME_DURATION_OPTIONS = [
    { value: 30, label: "30 min" },
    { value: 60, label: "1 hour" },
    { value: 120, label: "2 hours" },
    { value: 240, label: "4 hours" },
    { value: 1440, label: "All day" },
];
const PRICE_PRESETS = [
    { key: "free", label: "Free only", min: "0", max: "0" },
    { key: "under2", label: "Under GBP 2", min: "", max: "2" },
    { key: "under5", label: "Under GBP 5", min: "", max: "5" },
    { key: "under10", label: "Under GBP 10", min: "", max: "10" },
    { key: "none", label: "No limit", min: "", max: "" },
] as const;
const SORT_OPTIONS: Array<{ value: SortMode; label: string }> = [
    { value: "distance", label: "Closest first" },
    { value: "price_low", label: "Price: low to high" },
    { value: "price_high", label: "Price: high to low" },
    { value: "newest", label: "Newest listings" },
];

function createInitialSearch(): HomeSearchState {
    return {
        query: "",
        minPrice: "",
        maxPrice: "",
        date: "",
        startTime: toTimeInput(nextWholeQuarterHour()),
        durationMinutes: 60,
    };
}

function formatPriceSummary(search: HomeSearchState) {
    const min = search.minPrice.trim();
    const max = search.maxPrice.trim();
    if (!min && !max) return "Any price";
    if (min === "0" && max === "0") return "Free only";
    if (!min && max) return `Under GBP ${toFiniteNumber(max).toFixed(0)}`;
    if (min && !max) return `GBP ${toFiniteNumber(min).toFixed(0)}+ / hr`;
    return `GBP ${toFiniteNumber(min).toFixed(0)} - GBP ${toFiniteNumber(max).toFixed(0)} / hr`;
}

function formatTypeSummary(filter: ModeFilter) {
    const active = (Object.entries(filter) as Array<[ParkingSpot["mode"], boolean]>)
        .filter(([, enabled]) => enabled)
        .map(([mode]) => capitalizeLabel(mode));
    if (active.length === 3) return "All types";
    if (!active.length) return "No types selected";
    return active.join(", ");
}

function formatSortSummary(sort: SortMode) {
    return SORT_OPTIONS.find((option) => option.value === sort)?.label ?? "Closest first";
}

function currentPricePreset(search: HomeSearchState) {
    return PRICE_PRESETS.find((preset) => preset.min === search.minPrice.trim() && preset.max === search.maxPrice.trim())?.key ?? null;
}

function FilterGlyph({ kind }: { kind: "search" | "location" | FilterSection }) {
    if (kind === "search") {
        return (
            <svg viewBox="0 0 20 20" aria-hidden="true">
                <circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <path d="M13.2 13.2L17 17" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
            </svg>
        );
    }

    if (kind === "location") {
        return (
            <svg viewBox="0 0 20 20" aria-hidden="true">
                <circle cx="10" cy="10" r="5" fill="none" stroke="currentColor" strokeWidth="1.7" />
                <circle cx="10" cy="10" r="1.6" fill="currentColor" />
                <path d="M10 2.4v2.1M10 15.5v2.1M2.4 10h2.1M15.5 10h2.1" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
            </svg>
        );
    }

    if (kind === "when") {
        return (
            <svg viewBox="0 0 20 20" aria-hidden="true">
                <rect x="3.2" y="4.2" width="13.6" height="12.4" rx="2.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <path d="M6.1 2.8v2.5M13.9 2.8v2.5M3.2 7.2h13.6" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
            </svg>
        );
    }

    if (kind === "price") {
        return (
            <svg viewBox="0 0 20 20" aria-hidden="true">
                <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <path d="M9.4 6.3h2.3a1.8 1.8 0 0 1 0 3.6H8.8a1.8 1.8 0 0 0 0 3.6H12M10 5.1v9.8" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
            </svg>
        );
    }

    if (kind === "type") {
        return (
            <svg viewBox="0 0 20 20" aria-hidden="true">
                <rect x="3.2" y="3.2" width="5.4" height="5.4" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
                <rect x="11.4" y="3.2" width="5.4" height="5.4" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
                <rect x="3.2" y="11.4" width="5.4" height="5.4" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
                <rect x="11.4" y="11.4" width="5.4" height="5.4" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
            </svg>
        );
    }

    return (
        <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M3.5 5h13M6.5 10h7M8.8 15h2.4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
        </svg>
    );
}

function priceValue(spot: ParkingSpot) {
    if (spot.mode === "free") return 0;
    if (spot.mode === "auction") return Math.max(0, toFiniteNumber(spot.auction_start_price_gbp));
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

    const [draftSearch, setDraftSearch] = useState<HomeSearchState>(() => createInitialSearch());
    const [activeSearch, setActiveSearch] = useState<HomeSearchState>(() => createInitialSearch());
    const [draftSort, setDraftSort] = useState<SortMode>("distance");
    const [activeSort, setActiveSort] = useState<SortMode>("distance");
    const [draftModeFilter, setDraftModeFilter] = useState<ModeFilter>(DEFAULT_MODE_FILTER);
    const [activeModeFilter, setActiveModeFilter] = useState<ModeFilter>(DEFAULT_MODE_FILTER);
    const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);
    const [locStatus, setLocStatus] = useState<string | null>(null);
    const [searchDialogOpen, setSearchDialogOpen] = useState(false);
    const [searchFeedback, setSearchFeedback] = useState<string | null>(null);
    const [openSection, setOpenSection] = useState<FilterSection | null>(null);

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
        const q = activeSearch.query.trim().toLowerCase();
        const minPrice = activeSearch.minPrice.trim() ? toFiniteNumber(activeSearch.minPrice, 0) : 0;
        const maxPrice = activeSearch.maxPrice.trim() ? toFiniteNumber(activeSearch.maxPrice, Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY;
        const searchWindow = buildSearchWindow(activeSearch);

        return spots.filter((spot) => {
            if (!activeModeFilter[spot.mode]) return false;
            if (q) {
                const searchable = `${spot.title} ${spot.address_text} ${spot.description}`.toLowerCase();
                if (!searchable.includes(q)) return false;
            }
            if (priceValue(spot) < minPrice) return false;
            if (Number.isFinite(maxPrice) && priceValue(spot) > maxPrice) return false;
            if (searchWindow && !isSpotSlotAllowed(spot, searchWindow.start, searchWindow.end)) return false;
            return true;
        });
    }, [spots, activeSearch, activeModeFilter]);

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
            if (activeSort === "distance") return a.distKm - b.distKm;
            if (activeSort === "price_low") return a.price - b.price;
            if (activeSort === "price_high") return b.price - a.price;
            return new Date(b.spot.created_at).getTime() - new Date(a.spot.created_at).getTime();
        });

        return rows;
    }, [filtered, anchor, activeSort]);

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
    const locationButtonLabel =
        isLocEnabled ? "Location enabled"
        : isLocPending ? "Enabling..."
        : locStatus === "Location was blocked." ? "Location blocked"
        : locStatus === "Location is not supported on this browser." ? "Not supported"
        : "Enable location";

    function toggleMode(mode: ParkingSpot["mode"]) {
        setDraftModeFilter((current) => ({ ...current, [mode]: !current[mode] }));
    }

    function toggleSection(section: FilterSection) {
        setOpenSection((current) => (current === section ? null : section));
    }

    function resetFilters() {
        const initialSearch = createInitialSearch();
        setDraftSearch(initialSearch);
        setActiveSearch(initialSearch);
        setDraftSort("distance");
        setActiveSort("distance");
        setDraftModeFilter(DEFAULT_MODE_FILTER);
        setActiveModeFilter(DEFAULT_MODE_FILTER);
        setSearchFeedback(null);
        setOpenSection(null);
    }

    function submitSearch(event?: React.FormEvent) {
        event?.preventDefault();
        const next = {
            ...draftSearch,
            query: draftSearch.query.trim(),
            minPrice: draftSearch.minPrice.trim(),
            maxPrice: draftSearch.maxPrice.trim(),
            startTime: normalizeTimeInput(draftSearch.startTime),
        };

        if (next.minPrice && toFiniteNumber(next.minPrice, -1) < 0) {
            setSearchFeedback("Minimum price must be zero or higher.");
            return;
        }
        if (next.maxPrice && toFiniteNumber(next.maxPrice, -1) < 0) {
            setSearchFeedback("Maximum price must be zero or higher.");
            return;
        }
        if (next.minPrice && next.maxPrice && toFiniteNumber(next.minPrice) > toFiniteNumber(next.maxPrice)) {
            setSearchFeedback("Minimum price cannot be higher than maximum price.");
            return;
        }
        if (!Object.values(draftModeFilter).some(Boolean)) {
            setSearchFeedback("Choose at least one listing type.");
            return;
        }

        setActiveSearch(next);
        setActiveSort(draftSort);
        setActiveModeFilter(draftModeFilter);
        setSearchFeedback(null);
        spotsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
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
                setDraftSearch((current) => ({ ...current, query: "Using your location" }));
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

    const locationTooltip = isLocEnabled ? "Location enabled" : "Enable location";
    const whenSummary = formatSearchWindowSummary(draftSearch);
    const priceSummary = formatPriceSummary(draftSearch);
    const typeSummary = formatTypeSummary(draftModeFilter);
    const sortSummary = formatSortSummary(draftSort);
    const selectedPricePreset = currentPricePreset(draftSearch);

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
                    <form className="card home-controls home-controls--search" onSubmit={submitSearch}>
                        <div className="homeFilterTopRow">
                            <label className="homeFilterSearchShell" aria-label="Search by location">
                                <span className="homeFilterSearchIcon">
                                    <FilterGlyph kind="search" />
                                </span>
                                <input
                                    className="homeFilterSearchInput"
                                    value={draftSearch.query}
                                    onChange={(event) => setDraftSearch((current) => ({ ...current, query: event.target.value }))}
                                    placeholder="Area, street or landmark..."
                                />
                            </label>

                            <div className="homeFilterLocateWrap">
                                <button
                                    type="button"
                                    className={`homeFilterLocateBtn${isLocEnabled ? " is-enabled" : ""}${locStatus === "Location was blocked." ? " is-blocked" : ""}`}
                                    onClick={requestLocation}
                                    disabled={isLocPending}
                                    aria-label={locationButtonLabel}
                                >
                                    <FilterGlyph kind="location" />
                                    <span className="homeFilterLocateBadge">?</span>
                                </button>
                                <div className="homeFilterTooltip" role="status">{locationTooltip}</div>
                            </div>
                        </div>

                        <div className="homeFilterSection">
                            <button
                                type="button"
                                className={`homeFilterSectionHead${openSection === "when" ? " is-open" : ""}`}
                                onClick={() => toggleSection("when")}
                                aria-expanded={openSection === "when"}
                            >
                                <span className="homeFilterSectionLead">
                                    <span className="homeFilterIconTile">
                                        <FilterGlyph kind="when" />
                                    </span>
                                    <span className="homeFilterSectionCopy">
                                        <span className={`homeFilterSectionLabel${draftSearch.date ? " is-set" : ""}`}>When</span>
                                        <span className={`homeFilterSectionValue${draftSearch.date ? " is-set" : ""}`}>{whenSummary}</span>
                                    </span>
                                </span>
                                <span className={`homeFilterChevron${openSection === "when" ? " is-open" : ""}`}>{"▾"}</span>
                            </button>
                            <div className={`homeFilterSectionBody${openSection === "when" ? " is-open" : ""}`}>
                                <div className="homeFilterSectionInner">
                                    <button
                                        type="button"
                                        className="homeFilterPickerButton"
                                        onClick={() => setSearchDialogOpen(true)}
                                    >
                                        <span className="homeFilterFieldEyebrow">Date and time</span>
                                        <strong>{draftSearch.date || "Choose date and time"}</strong>
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="homeFilterSection">
                            <button
                                type="button"
                                className={`homeFilterSectionHead${openSection === "price" ? " is-open" : ""}`}
                                onClick={() => toggleSection("price")}
                                aria-expanded={openSection === "price"}
                            >
                                <span className="homeFilterSectionLead">
                                    <span className="homeFilterIconTile">
                                        <FilterGlyph kind="price" />
                                    </span>
                                    <span className="homeFilterSectionCopy">
                                        <span className={`homeFilterSectionLabel${priceSummary !== "Any price" ? " is-set" : ""}`}>Price</span>
                                        <span className={`homeFilterSectionValue${priceSummary !== "Any price" ? " is-set" : ""}`}>{priceSummary}</span>
                                    </span>
                                </span>
                                <span className={`homeFilterChevron${openSection === "price" ? " is-open" : ""}`}>{"▾"}</span>
                            </button>
                            <div className={`homeFilterSectionBody${openSection === "price" ? " is-open" : ""}`}>
                                <div className="homeFilterSectionInner">
                                    <div className="homeFilterPillRow" role="group" aria-label="Price presets">
                                        {PRICE_PRESETS.map((preset) => (
                                            <button
                                                key={preset.key}
                                                type="button"
                                                className={`homeFilterPill${selectedPricePreset === preset.key ? " is-active" : ""}`}
                                                onClick={() =>
                                                    setDraftSearch((current) => ({
                                                        ...current,
                                                        minPrice: preset.min,
                                                        maxPrice: preset.max,
                                                    }))
                                                }
                                            >
                                                {preset.label}
                                            </button>
                                        ))}
                                    </div>

                                    <div className="homeFilterFieldGrid">
                                        <label className="homeFilterField">
                                            <span className="homeFilterFieldEyebrow">Min / hr</span>
                                            <input
                                                className="homeFilterInput"
                                                type="number"
                                                min="0"
                                                step="0.5"
                                                value={draftSearch.minPrice}
                                                onChange={(event) =>
                                                    setDraftSearch((current) => ({ ...current, minPrice: event.target.value }))
                                                }
                                                placeholder="0"
                                            />
                                        </label>

                                        <label className="homeFilterField">
                                            <span className="homeFilterFieldEyebrow">Max / hr</span>
                                            <input
                                                className="homeFilterInput"
                                                type="number"
                                                min="0"
                                                step="0.5"
                                                value={draftSearch.maxPrice}
                                                onChange={(event) =>
                                                    setDraftSearch((current) => ({ ...current, maxPrice: event.target.value }))
                                                }
                                                placeholder="No limit"
                                            />
                                        </label>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="homeFilterSection">
                            <button
                                type="button"
                                className={`homeFilterSectionHead${openSection === "type" ? " is-open" : ""}`}
                                onClick={() => toggleSection("type")}
                                aria-expanded={openSection === "type"}
                            >
                                <span className="homeFilterSectionLead">
                                    <span className="homeFilterIconTile">
                                        <FilterGlyph kind="type" />
                                    </span>
                                    <span className="homeFilterSectionCopy">
                                        <span className="homeFilterSectionLabel is-set">Type</span>
                                        <span className="homeFilterSectionValue is-set">{typeSummary}</span>
                                    </span>
                                </span>
                                <span className={`homeFilterChevron${openSection === "type" ? " is-open" : ""}`}>{"▾"}</span>
                            </button>
                            <div className={`homeFilterSectionBody${openSection === "type" ? " is-open" : ""}`}>
                                <div className="homeFilterSectionInner">
                                    <div className="homeFilterToggleRow" role="group" aria-label="Filter by listing type">
                                        {(["rent", "free", "auction"] as const).map((mode) => (
                                            <button
                                                key={mode}
                                                type="button"
                                                className={`homeFilterToggle${draftModeFilter[mode] ? " is-active" : ""}`}
                                                onClick={() => toggleMode(mode)}
                                            >
                                                {capitalizeLabel(mode)}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="homeFilterSection">
                            <button
                                type="button"
                                className={`homeFilterSectionHead${openSection === "sort" ? " is-open" : ""}`}
                                onClick={() => toggleSection("sort")}
                                aria-expanded={openSection === "sort"}
                            >
                                <span className="homeFilterSectionLead">
                                    <span className="homeFilterIconTile">
                                        <FilterGlyph kind="sort" />
                                    </span>
                                    <span className="homeFilterSectionCopy">
                                        <span className="homeFilterSectionLabel is-set">Sort</span>
                                        <span className="homeFilterSectionValue is-set">{sortSummary}</span>
                                    </span>
                                </span>
                                <span className={`homeFilterChevron${openSection === "sort" ? " is-open" : ""}`}>{"▾"}</span>
                            </button>
                            <div className={`homeFilterSectionBody${openSection === "sort" ? " is-open" : ""}`}>
                                <div className="homeFilterSectionInner">
                                    <div className="homeFilterSortList" role="radiogroup" aria-label="Sort listings">
                                        {SORT_OPTIONS.map((option) => (
                                            <button
                                                key={option.value}
                                                type="button"
                                                className={`homeFilterSortOption${draftSort === option.value ? " is-active" : ""}`}
                                                onClick={() => setDraftSort(option.value)}
                                                role="radio"
                                                aria-checked={draftSort === option.value}
                                            >
                                                <span>{option.label}</span>
                                                <span className="homeFilterRadio" aria-hidden="true">
                                                    <span className="homeFilterRadioDot" />
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {searchFeedback && <div className="homeFilterNotice">{searchFeedback}</div>}

                        <div className="homeFilterFooter">
                            <span className="homeFilterCount">{visible.length} spot{visible.length === 1 ? "" : "s"} found</span>
                            <button type="button" className="homeFilterFooterBtn homeFilterFooterBtn--ghost" onClick={resetFilters}>
                                Reset all
                            </button>
                            <button type="submit" className="homeFilterFooterBtn homeFilterFooterBtn--primary">
                                Search
                            </button>
                        </div>
                    </form>

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

            <HomeDatePickerDialog
                open={searchDialogOpen}
                selectedDate={draftSearch.date}
                startTime={draftSearch.startTime}
                durationMinutes={draftSearch.durationMinutes}
                durationOptions={HOME_DURATION_OPTIONS}
                onSelectDate={(date) => setDraftSearch((current) => ({ ...current, date }))}
                onStartTimeChange={(startTime) =>
                    setDraftSearch((current) => ({
                        ...current,
                        startTime: normalizeTimeInput(startTime),
                    }))
                }
                onDurationChange={(durationMinutes) =>
                    setDraftSearch((current) => ({
                        ...current,
                        durationMinutes,
                    }))
                }
                onApply={() => setSearchDialogOpen(false)}
                onClear={() =>
                    setDraftSearch((current) => ({
                        ...current,
                        date: "",
                    }))
                }
                onClose={() => setSearchDialogOpen(false)}
            />
        </div>
    );
}
