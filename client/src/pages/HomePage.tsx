import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
    CalendarIcon,
    ChevronDownIcon,
    ClockIcon,
    Crosshair2Icon,
    DashboardIcon,
    MagnifyingGlassIcon,
    MixerHorizontalIcon,
    ValueIcon,
} from "@radix-ui/react-icons";
import Lottie from "lottie-react";
import { Link } from "react-router-dom";
import AppPageState from "../components/AppPageState";
import SpotsMap from "../components/SpotsMap";
import { AppDisclosure } from "../components/ui/AppDisclosure";
import { AppMultiToggleGroup, AppRadioCards } from "../components/ui/AppChoiceControls";
import { InfoTooltip } from "../components/ui/InfoTooltip";
import { apiGet } from "../lib/api";
import type { ParkingSpot } from "../types";
import { capitalizeLabel, formatDateDisplay, toFiniteNumber } from "./pagesShared";
import {
    buildSearchWindow,
    formatSearchWindowSummary,
    type HomeSearchState,
} from "./homeSearchUtils";
import { HomeDatePickerDialog, HomeTimePickerDialog } from "./homeSearchSupport";
import { listingFeatureLabel, listingFeatureTone } from "./createListingSupport";
import {
    isSlotAllowed as isSpotSlotAllowed,
    nextWholeQuarterHour,
    normalizeTimeInput,
    toTimeInput,
} from "./spotDetailsSupport";

type SortMode = "distance" | "price_low" | "price_high" | "newest";
type ModeFilter = Record<ParkingSpot["mode"], boolean>;

const LONDON = { lat: 51.5074, lng: -0.1278 };
const LOCATION_SEARCH_LABEL = "Using your location";
const HOME_HERO_BACKGROUND_URL = new URL("../assets/loading_hero.json", import.meta.url).href;
const HOME_HERO_CITY_URL = new URL("../assets/city.json", import.meta.url).href;
const DEFAULT_MODE_FILTER: ModeFilter = { free: true, rent: true, auction: true };
const HOME_DURATION_OPTIONS = [
    { value: 30, label: "30 min" },
    { value: 60, label: "1 hour" },
    { value: 120, label: "2 hours" },
    { value: 180, label: "3 hours" },
    { value: 240, label: "4 hours" },
    { value: 360, label: "6 hours" },
    { value: 480, label: "8 hours" },
    { value: 600, label: "10 hours" },
    { value: 720, label: "12 hours" },
    { value: 960, label: "16 hours" },
    { value: 1200, label: "20 hours" },
    { value: 1440, label: "24+ hours" },
];
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

function normalizeSearchQuery(query: string, userLoc: { lat: number; lng: number } | null) {
    const trimmed = query.trim();
    if (userLoc && trimmed.toLowerCase() === LOCATION_SEARCH_LABEL.toLowerCase()) {
        return "";
    }
    return trimmed;
}

function HomeFilterSection({
    icon,
    label,
    value,
    isSet,
    children,
    defaultOpen = false,
}: {
    icon: ReactNode;
    label: string;
    value: string;
    isSet: boolean;
    children: ReactNode;
    defaultOpen?: boolean;
}) {
    return (
        <AppDisclosure
            defaultExpanded={defaultOpen}
            className="homeFilterSection"
            triggerClassName="homeFilterSectionHead"
            panelClassName="homeFilterSectionBody"
            trigger={(open) => (
                <>
                    <span className="homeFilterSectionLead">
                        <span className="homeFilterIconTile">{icon}</span>
                        <span className="homeFilterSectionCopy">
                            <span className={`homeFilterSectionLabel${isSet ? " is-set" : ""}`}>{label}</span>
                            <span className={`homeFilterSectionValue${isSet ? " is-set" : ""}`}>{value}</span>
                        </span>
                    </span>
                    <ChevronDownIcon className={`homeFilterChevron${open ? " is-open" : ""}`} aria-hidden="true" />
                </>
            )}
        >
            <div className="homeFilterSectionInner">{children}</div>
        </AppDisclosure>
    );
}

function HomeDurationSelect({
    value,
    onChange,
    disabled,
}: {
    value: number;
    onChange: (value: number) => void;
    disabled?: boolean;
}) {
    return (
        <div className={`homeFilterSelect${disabled ? " is-disabled" : ""}`}>
            <select
                aria-label="Duration"
                value={String(value)}
                onChange={(event) => onChange(Number(event.target.value))}
                disabled={disabled}
                className="homeFilterSelectInput"
            >
                {HOME_DURATION_OPTIONS.map((option) => (
                    <option key={`home-duration-${option.value}`} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </select>
            <ChevronDownIcon className="homeFilterSelectIcon" aria-hidden="true" />
        </div>
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

function cardFeatures(spot: ParkingSpot) {
    const rawFeatures = Array.isArray(spot.availability_json?.features)
        ? spot.availability_json.features
        : [];

    return rawFeatures
        .filter((feature): feature is string => typeof feature === "string" && feature.trim().length > 0)
        .slice(0, 2);
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
    const [dateDialogOpen, setDateDialogOpen] = useState(false);
    const [timeDialogOpen, setTimeDialogOpen] = useState(false);
    const [searchFeedback, setSearchFeedback] = useState<string | null>(null);

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [hoveredId, setHoveredId] = useState<string | null>(null);

    const spotsRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<HTMLElement | null>(null);

    function scrollToFirstSpot() {
        if (typeof window === "undefined") return;

        window.requestAnimationFrame(() => {
            const target =
                spotsRef.current?.querySelector<HTMLElement>(".spot-card") ??
                spotsRef.current;

            if (!target) return;

            const navHeight = document.querySelector<HTMLElement>(".nav")?.getBoundingClientRect().height ?? 0;
            const top = target.getBoundingClientRect().top + window.scrollY - navHeight - 475;

            window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
        });
    }

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
        const q = normalizeSearchQuery(activeSearch.query, userLoc).toLowerCase();
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
    }, [spots, activeSearch, activeModeFilter, userLoc]);

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


    function resetFilters() {
        const initialSearch = createInitialSearch();
        setDraftSearch(initialSearch);
        setActiveSearch(initialSearch);
        setDraftSort("distance");
        setActiveSort("distance");
        setDraftModeFilter(DEFAULT_MODE_FILTER);
        setActiveModeFilter(DEFAULT_MODE_FILTER);
        setSearchFeedback(null);
    }

    function submitSearch(event?: React.FormEvent) {
        event?.preventDefault();
        const next = {
            ...draftSearch,
            query: normalizeSearchQuery(draftSearch.query, userLoc),
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
        scrollToFirstSpot();
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
                setDraftSearch((current) => ({ ...current, query: LOCATION_SEARCH_LABEL }));
                setLocStatus("Location enabled.");
            },
            () => {
                setLocStatus("Location was blocked.");
            }
        );
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
    const selectedModes = (["rent", "free", "auction"] as const).filter((mode) => draftModeFilter[mode]);

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
                    <Link to="/create-listing" className="btn btn-primary">List a spot</Link>
                    <button type="button" className="btn btn-ghost" onClick={scrollToFirstSpot}>View spots</button>
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
                                    <MagnifyingGlassIcon />
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
                                    <Crosshair2Icon />
                                </button>
                                <InfoTooltip
                                    label={locationButtonLabel}
                                    text={locationTooltip}
                                    triggerClassName={`homeFilterLocateBadge${isLocEnabled ? " is-enabled" : ""}`}
                                />
                        </div>
                        </div>

                        <HomeFilterSection icon={<CalendarIcon />} label="When" value={whenSummary} isSet={!!draftSearch.date}>
                            <div className="homeFilterWhenGrid">
                                <button
                                    type="button"
                                    className="homeFilterPickerButton homeFilterPickerButton--choice"
                                    onClick={() => setDateDialogOpen(true)}
                                >
                                    <span className="homeFilterPickerIcon" aria-hidden="true">
                                        <CalendarIcon />
                                    </span>
                                    <span className="homeFilterPickerCopy">
                                        <span className="homeFilterFieldEyebrow">Date</span>
                                        <span className="homeFilterPickerValue">
                                            {draftSearch.date ? formatDateDisplay(draftSearch.date) : "Any date"}
                                        </span>
                                    </span>
                                </button>

                                <button
                                    type="button"
                                    className="homeFilterPickerButton homeFilterPickerButton--choice"
                                    onClick={() => setTimeDialogOpen(true)}
                                    disabled={!draftSearch.date}
                                >
                                    <span className="homeFilterPickerIcon" aria-hidden="true">
                                        <ClockIcon />
                                    </span>
                                    <span className="homeFilterPickerCopy">
                                        <span className="homeFilterFieldEyebrow">Time</span>
                                        <span className="homeFilterPickerValue">
                                            {draftSearch.date ? draftSearch.startTime : "First select date"}
                                        </span>
                                    </span>
                                </button>
                            </div>

                            <label className="homeFilterField">
                                <span className="homeFilterFieldEyebrow">Duration</span>
                                <HomeDurationSelect
                                    value={draftSearch.durationMinutes}
                                    onChange={(durationMinutes) =>
                                        setDraftSearch((current) => ({
                                            ...current,
                                            durationMinutes,
                                        }))
                                    }
                                    disabled={!draftSearch.date}
                                />
                            </label>
                        </HomeFilterSection>

                        <HomeFilterSection
                            icon={<ValueIcon />}
                            label="Price"
                            value={priceSummary}
                            isSet={priceSummary !== "Any price"}
                        >
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
                        </HomeFilterSection>

                        <HomeFilterSection icon={<DashboardIcon />} label="Type" value={typeSummary} isSet={typeSummary !== "All types"}>
                            <AppMultiToggleGroup
                                ariaLabel="Filter by listing type"
                                className="homeFilterToggleRow"
                                itemClassName="homeFilterToggle"
                                values={selectedModes}
                                onChange={(values) =>
                                    setDraftModeFilter({
                                        rent: values.includes("rent"),
                                        free: values.includes("free"),
                                        auction: values.includes("auction"),
                                    })
                                }
                                options={(["rent", "free", "auction"] as const).map((mode) => ({
                                    id: mode,
                                    content: capitalizeLabel(mode),
                                }))}
                            />
                        </HomeFilterSection>

                        <HomeFilterSection icon={<MixerHorizontalIcon />} label="Sort" value={sortSummary} isSet>
                            <AppRadioCards
                                ariaLabel="Sort listings"
                                className="homeFilterSortList"
                                itemClassName="homeFilterSortOption"
                                value={draftSort}
                                onChange={setDraftSort}
                                orientation="vertical"
                                options={SORT_OPTIONS.map((option) => ({
                                    id: option.value,
                                    content: (
                                        <>
                                            <span>{option.label}</span>
                                            <span className="homeFilterRadio" aria-hidden="true">
                                                <span className="homeFilterRadioDot" />
                                            </span>
                                        </>
                                    ),
                                }))}
                            />
                        </HomeFilterSection>
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
                        {error && !loading && (
                            <AppPageState
                                card
                                title="The map took a scenic route."
                                copy="Those spots did not load properly. Head back home and try again in a moment."
                                actionLabel={null}
                            />
                        )}
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
                            const features = cardFeatures(spot);

                            return (
                                <article
                                    key={spot.id}
                                    role="listitem"
                                    tabIndex={0}
                                    className={`spot-card${active ? " is-active" : ""}`}
                                    onFocus={() => setHoveredId(spot.id)}
                                    onBlur={() => setHoveredId((prev) => (prev === spot.id ? null : prev))}
                                    onMouseEnter={() => setHoveredId(spot.id)}
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
                                            <p className="spot-summary" title={spot.address_text}>
                                                {spot.address_text}
                                            </p>
                                            {features.length > 0 && (
                                                <div className="spot-features">
                                                    {features.map((feature) => (
                                                        <span key={feature} className={`spot-feature spot-feature--${listingFeatureTone(feature)}`}>
                                                            {listingFeatureLabel(feature)}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                        <div className="spot-thumb" aria-hidden="true">
                                            {spot.image_url ? (
                                                <img src={spot.image_url} alt="" className="spot-thumb-img" />
                                            ) : (
                                                <div className="spot-thumb-fallback">No image</div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="spot-foot">
                                        <div className="spot-meta">
                                            <span className={`spot-price spot-price--${spot.mode}${price.pointsLabel ? " spot-price--stacked" : ""}`}>
                                                <span className="spot-price-main">{price.main}</span>
                                                {price.pointsLabel && (
                                                    <>
                                                        <span className="spot-price-or">or</span>
                                                        <span className="spot-price-points">{price.pointsLabel}</span>
                                                    </>
                                                )}
                                            </span>
                                            <span className="spot-distance">{distKm.toFixed(1)} km</span>
                                        </div>

                                        <div className="spot-actions">
                                            <Link
                                                to={`/spots/${spot.id}`}
                                                className="btn btn-primary"
                                                onClick={(event) => event.stopPropagation()}
                                            >
                                                Book now
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
                        userLocation={isLocEnabled ? userLoc : null}
                        onSelect={(id) => setSelectedId(id)}
                        onHover={(id) => setHoveredId(id)}
                    />
                </section>
            </section>

            <HomeDatePickerDialog
                open={dateDialogOpen}
                selectedDate={draftSearch.date}
                onSelectDate={(date) => setDraftSearch((current) => ({ ...current, date }))}
                onApply={() => setDateDialogOpen(false)}
                onClear={() =>
                    setDraftSearch((current) => ({
                        ...current,
                        date: "",
                    }))
                }
                onClose={() => setDateDialogOpen(false)}
            />
            <HomeTimePickerDialog
                open={timeDialogOpen}
                value={draftSearch.startTime}
                onChange={(startTime) =>
                    setDraftSearch((current) => ({
                        ...current,
                        startTime: normalizeTimeInput(startTime),
                    }))
                }
                onClose={() => setTimeDialogOpen(false)}
            />
        </div>
    );
}
