import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import L from "leaflet";
import { MapContainer, Marker, TileLayer, useMapEvents } from "react-leaflet";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { apiGet, apiPatch, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { ParkingSpot } from "../types";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

type Mode = "free" | "rent" | "auction";
type PriceUnit = "hour" | "day" | "week";
type AvailabilityPreset = "always" | "weekdays" | "weekends" | "custom";
type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;
type FlowStep = Exclude<WizardStep, 1>;
type SpaceChoice = "1" | "2" | "3" | "4plus";
type Tone = "blue" | "lilac" | "mint" | "cream" | "sky" | "sage";

type GeocodeSuggestion = {
    display_name: string;
    lat: string;
    lon: string;
};

type AvailabilitySlot = {
    id: string;
    dow: number;
    start: string;
    end: string;
};

const STEP_COUNT = 6;
const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DEFAULT_CENTER: [number, number] = [51.5074, -0.1278];
const LONDON_VIEWBOX = "-0.5103,51.6919,0.3340,51.2868";
const MIN_AUCTION_START_PRICE_GBP = 0.1;
const MIN_POINTS_COST = 1;
const DEFAULT_AUCTION_START_PRICE = String(MIN_AUCTION_START_PRICE_GBP);
const DEFAULT_POINTS_COST = String(MIN_POINTS_COST);

const SPACE_CHOICES: Array<{ id: SpaceChoice; label: string; value: number }> = [
    { id: "1", label: "1 space", value: 1 },
    { id: "2", label: "2 spaces", value: 2 },
    { id: "3", label: "3 spaces", value: 3 },
    { id: "4plus", label: "4+ spaces", value: 4 },
];

const MODEL_CHOICES: Array<{ mode: Mode; title: string; copy: string; tone: Tone; help: string }> = [
    {
        mode: "rent",
        title: "Rent",
        copy: "Fixed pricing for instant bookings.",
        tone: "blue",
        help: "Drivers can book instantly at the rate you set.",
    },
    {
        mode: "auction",
        title: "Auction",
        copy: "Drivers submit offers. You approve what works.",
        tone: "lilac",
        help: "Drivers send offers and you decide which bid to accept.",
    },
    {
        mode: "free",
        title: "Free",
        copy: "No payment required for this listing.",
        tone: "mint",
        help: "Bookings are free to drivers and no payment is collected.",
    },
];

const STEP_META: Record<FlowStep, { panelTitle: string; panelCopy: string; panelTone: Tone; title: string; subtitle: string }> = {
    2: {
        panelTitle: "Basics",
        panelCopy: "Set the core details so drivers quickly understand your space.",
        panelTone: "blue",
        title: "Listing basics",
        subtitle: "Keep this short, clear, and practical.",
    },
    3: {
        panelTitle: "Pricing",
        panelCopy: "Choose a simple pricing setup that matches your listing model.",
        panelTone: "lilac",
        title: "Pricing",
        subtitle: "Set how drivers pay for this listing.",
    },
    4: {
        panelTitle: "Availability",
        panelCopy: "Define when drivers can request or book this space.",
        panelTone: "mint",
        title: "Availability",
        subtitle: "Choose quick presets or custom day and time windows.",
    },
    5: {
        panelTitle: "Location",
        panelCopy: "Add a searchable address and confirm the exact map pin.",
        panelTone: "cream",
        title: "Location",
        subtitle: "Search once, then fine-tune by tapping on the map.",
    },
    6: {
        panelTitle: "Images",
        panelCopy: "A clear image improves trust and click-through for drivers.",
        panelTone: "sky",
        title: "Images",
        subtitle: "Optional, but strongly recommended.",
    },
};

const AVAILABILITY_CHOICES: Array<{
    id: AvailabilityPreset;
    title: string;
    copy: string;
    tone: "blue" | "lilac" | "mint" | "cream";
}> = [
    { id: "always", title: "24/7", copy: "Always available", tone: "blue" },
    { id: "weekdays", title: "Weekdays", copy: "Mon-Fri", tone: "lilac" },
    { id: "weekends", title: "Weekends", copy: "Sat-Sun", tone: "mint" },
    { id: "custom", title: "Custom", copy: "Choose days and times", tone: "cream" },
];

const PRICE_UNIT_CHOICES: Array<{ id: PriceUnit; label: string }> = [
    { id: "hour", label: "Hourly" },
    { id: "day", label: "Daily" },
    { id: "week", label: "Weekly" },
];

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: markerIcon2x,
    iconUrl: markerIcon,
    shadowUrl: markerShadow,
});

const defaultIcon = new L.Icon.Default();

function isTime(value: string) {
    return /^\d{2}:\d{2}$/.test(value);
}

function minutes(value: string) {
    const [h, m] = value.split(":").map(Number);
    return h * 60 + m;
}

function parseCoordinates(lat: string, lng: string) {
    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return null;
    if (latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) return null;
    return { lat: latNum, lng: lngNum };
}

function pad2(value: number) {
    return String(value).padStart(2, "0");
}

function toLocalDateInput(date: Date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function dateFromToday(daysAhead: number) {
    const next = new Date();
    next.setHours(0, 0, 0, 0);
    next.setDate(next.getDate() + daysAhead);
    return toLocalDateInput(next);
}

function createSlot(partial?: Partial<Omit<AvailabilitySlot, "id">>): AvailabilitySlot {
    return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        dow: partial?.dow ?? 1,
        start: partial?.start ?? "09:00",
        end: partial?.end ?? "17:00",
    };
}

function areSlotsValid(slots: AvailabilitySlot[]) {
    return slots.every(
        (slot) =>
            Number.isInteger(Number(slot.dow)) &&
            Number(slot.dow) >= 0 &&
            Number(slot.dow) <= 6 &&
            isTime(slot.start) &&
            isTime(slot.end) &&
            minutes(slot.start) < minutes(slot.end)
    );
}

function modeLabel(mode: Mode) {
    if (mode === "rent") return "Rent";
    if (mode === "auction") return "Auction";
    return "Free";
}

function modeSummary(mode: Mode) {
    if (mode === "rent") return "Fixed-price booking";
    if (mode === "auction") return "Owner-approved offers";
    return "No payment required";
}

function availabilityLabel(preset: AvailabilityPreset) {
    if (preset === "always") return "24/7";
    if (preset === "weekdays") return "Weekdays";
    if (preset === "weekends") return "Weekends";
    return "Custom";
}

function parseAvailabilityRules(rawRules: any): AvailabilitySlot[] {
    if (!Array.isArray(rawRules)) return [createSlot()];

    const parsed = rawRules
        .map((rule) => ({
            dow: Number(rule?.dow),
            start: typeof rule?.start === "string" ? rule.start : "",
            end: typeof rule?.end === "string" ? rule.end : "",
        }))
        .filter(
            (rule) =>
                Number.isInteger(rule.dow) &&
                rule.dow >= 0 &&
                rule.dow <= 6 &&
                isTime(rule.start) &&
                isTime(rule.end) &&
                minutes(rule.start) < minutes(rule.end)
        )
        .map((rule) => createSlot(rule));

    return parsed.length > 0 ? parsed : [createSlot()];
}

function quickPresetRules(preset: AvailabilityPreset) {
    if (preset === "weekdays") {
        return [1, 2, 3, 4, 5].map((dow) => ({ dow, start: "00:00", end: "23:59" }));
    }
    return [0, 6].map((dow) => ({ dow, start: "00:00", end: "23:59" }));
}

function MapPickerPin({
    position,
    onPick,
}: {
    position: [number, number] | null;
    onPick: (lat: number, lng: number) => void;
}) {
    useMapEvents({
        click(event) {
            onPick(event.latlng.lat, event.latlng.lng);
        },
    });

    if (!position) return null;
    return <Marker position={position} icon={defaultIcon} />;
}

function Tooltip({ label, text }: { label: string; text: string }) {
    return (
        <span className="wizardTooltip">
            <button type="button" className="wizardTooltipBtn" aria-label={label} title={text}>
                ?
            </button>
            <span role="tooltip" className="wizardTooltipBubble">
                {text}
            </span>
        </span>
    );
}

function SelectionTile({
    title,
    copy,
    help,
    tone,
    active,
    onClick,
}: {
    title: string;
    copy: string;
    help: string;
    tone: Tone;
    active: boolean;
    onClick: () => void;
}) {
    return (
        <article
            className={`wizardTile wizardTile--${tone}${active ? " is-active" : ""}`}
            onClick={onClick}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onClick();
                }
            }}
            role="button"
            tabIndex={0}
            aria-pressed={active}
        >
            <div className="wizardTileHead">
                <Tooltip label={`${title} mode help`} text={help} />
            </div>
            <span className="wizardTileTitle">{title}</span>
            <span className="wizardTileCopy">{copy}</span>
            <span className="wizardTileCheck" aria-hidden="true">
                Selected
            </span>
        </article>
    );
}

function StepShell({
    step,
    panel,
    title,
    subtitle,
    footer,
    children,
}: {
    step: FlowStep;
    panel: { panelTitle: string; panelCopy: string; panelTone: Tone };
    title: string;
    subtitle: string;
    footer: ReactNode;
    children: ReactNode;
}) {
    return (
        <section className="wizardSplit" key={`step-${step}`}>
            <aside className={`wizardLeft wizardLeft--${panel.panelTone}`}>
                <div className="wizardLeftLogo">ParkingBuddies</div>
                <div className="wizardLeftStep">
                    Step {step} of {STEP_COUNT}
                </div>
                <h2 className="wizardLeftTitle">{panel.panelTitle}</h2>
                <p className="wizardLeftCopy">{panel.panelCopy}</p>
            </aside>

            <section className="wizardRight">
                <div className="wizardCard">
                    <header className="wizardCardHead">
                        <h3 className="h2 wizardCardTitle">{title}</h3>
                        <p className="wizardCardSub">{subtitle}</p>
                    </header>

                    <div className="wizardCardBody">{children}</div>
                    <footer className="wizardCardFoot">{footer}</footer>
                </div>
            </section>
        </section>
    );
}

function StepNavigation({
    onBack,
    onNext,
    nextLabel = "Next",
    nextDisabled = false,
    backDisabled = false,
    hint = "",
}: {
    onBack: () => void;
    onNext: () => void;
    nextLabel?: string;
    nextDisabled?: boolean;
    backDisabled?: boolean;
    hint?: string;
}) {
    return (
        <div className="wizardActions">
            <button type="button" className="btn" onClick={onBack} disabled={backDisabled}>
                Back
            </button>
            <div className="wizardActionHint">{hint}</div>
            <button type="button" className="btn btn-primary" onClick={onNext} disabled={nextDisabled}>
                {nextLabel}
            </button>
        </div>
    );
}

function WizardSheet({
    open,
    title,
    subtitle,
    onClose,
    children,
    wide = false,
}: {
    open: boolean;
    title: string;
    subtitle: string;
    onClose: () => void;
    children: ReactNode;
    wide?: boolean;
}) {
    if (!open) return null;

    return (
        <div className="createSheetBackdrop" role="presentation" onClick={onClose}>
            <section
                className={`createSheet${wide ? " createSheet--wide" : ""}`}
                role="dialog"
                aria-modal="true"
                aria-label={title}
                onClick={(event) => event.stopPropagation()}
            >
                <div className="createSheetHead">
                    <div>
                        <div className="heroKicker">SETUP</div>
                        <div className="h3">{title}</div>
                        <div className="createFieldHint">{subtitle}</div>
                    </div>
                    <button type="button" className="btn" onClick={onClose}>
                        Close
                    </button>
                </div>

                {children}
            </section>
        </div>
    );
}

export default function CreateListingPage() {
    const { token, user } = useAuth();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const location = useLocation();

    const editId = searchParams.get("edit");
    const isEdit = Boolean(editId);

    const [activeStep, setActiveStep] = useState<WizardStep>(1);

    const [mode, setMode] = useState<Mode>("rent");
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [capacityTotal, setCapacityTotal] = useState("1");

    const [priceUnit, setPriceUnit] = useState<PriceUnit>("hour");
    const [price, setPrice] = useState("5");
    const [auctionStartPrice, setAuctionStartPrice] = useState(DEFAULT_AUCTION_START_PRICE);
    const [allowPoints, setAllowPoints] = useState(false);
    const [pointsCost, setPointsCost] = useState(DEFAULT_POINTS_COST);

    const [availabilityPreset, setAvailabilityPreset] = useState<AvailabilityPreset>("always");
    const [dateFrom, setDateFrom] = useState(() => dateFromToday(0));
    const [dateTo, setDateTo] = useState(() => dateFromToday(3));
    const [customSlots, setCustomSlots] = useState<AvailabilitySlot[]>([createSlot()]);

    const [addressText, setAddressText] = useState("");
    const [addressSearchBusy, setAddressSearchBusy] = useState(false);
    const [addressSearchMessage, setAddressSearchMessage] = useState("");
    const [lat, setLat] = useState(String(DEFAULT_CENTER[0]));
    const [lng, setLng] = useState(String(DEFAULT_CENTER[1]));

    const [imageUrl, setImageUrl] = useState("");
    const [spacesSheetOpen, setSpacesSheetOpen] = useState(false);
    const [pendingSpacesChoice, setPendingSpacesChoice] = useState<SpaceChoice>("1");
    const [pendingSpacesCustom, setPendingSpacesCustom] = useState("4");

    const [customSheetOpen, setCustomSheetOpen] = useState(false);

    const [confirmSheetOpen, setConfirmSheetOpen] = useState(false);

    const [loadingExisting, setLoadingExisting] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    const imageInputRef = useRef<HTMLInputElement | null>(null);

    const parsedCoords = useMemo(() => parseCoordinates(lat, lng), [lat, lng]);
    const mapCenter: [number, number] = parsedCoords ? [parsedCoords.lat, parsedCoords.lng] : DEFAULT_CENTER;
    const markerPosition: [number, number] | null = parsedCoords ? [parsedCoords.lat, parsedCoords.lng] : null;

    useEffect(() => {
        if (!isEdit || !token || !editId) return;

        let active = true;
        setLoadingExisting(true);
        setError("");

        apiGet<{ parking_spot: ParkingSpot }>(`/parking-spots/${editId}`, token)
            .then((res) => {
                if (!active) return;
                const listing = res.parking_spot;
                const av = (listing.availability_json ?? null) as any;

                setMode((listing.mode as Mode) ?? "rent");
                setTitle(listing.title ?? "");
                setDescription(listing.description ?? "");
                setPrice(listing.mode === "rent" ? String(listing.price_gbp ?? "") : "");
                setPriceUnit((listing.price_unit as PriceUnit) ?? "hour");
                setAllowPoints(Boolean(listing.allow_points));
                setPointsCost(String(listing.points_cost ?? DEFAULT_POINTS_COST));
                setAuctionStartPrice(
                    listing.auction_start_price_gbp == null
                        ? DEFAULT_AUCTION_START_PRICE
                        : String(listing.auction_start_price_gbp)
                );
                setCapacityTotal(String(listing.capacity_total ?? 1));
                setAddressText(listing.address_text ?? "");
                setLat(String(listing.lat ?? ""));
                setLng(String(listing.lng ?? ""));
                setImageUrl(listing.image_url ?? "");

                setDateFrom(typeof av?.date_from === "string" ? av.date_from : dateFromToday(0));
                setDateTo(typeof av?.date_to === "string" ? av.date_to : dateFromToday(3));

                if (av?.type === "24_7") {
                    setAvailabilityPreset("always");
                    setCustomSlots([createSlot()]);
                    return;
                }

                if (av?.type === "custom_weekly") {
                    const nextSlots = parseAvailabilityRules(av?.rules);
                    setAvailabilityPreset("custom");
                    setCustomSlots(nextSlots);
                    return;
                }

                if (av?.type === "same_everyday") {
                    const start = typeof av?.start === "string" && isTime(av.start) ? av.start : "09:00";
                    const end = typeof av?.end === "string" && isTime(av.end) ? av.end : "17:00";
                    setAvailabilityPreset("custom");
                    setCustomSlots([0, 1, 2, 3, 4, 5, 6].map((dow) => createSlot({ dow, start, end })));
                    return;
                }

                setAvailabilityPreset("always");
                setCustomSlots([createSlot()]);
            })
            .catch((e: any) => {
                if (!active) return;
                setError(e?.message || "Could not load listing for editing.");
            })
            .finally(() => {
                if (active) setLoadingExisting(false);
            });

        return () => {
            active = false;
        };
    }, [isEdit, editId, token]);

    useEffect(() => {
        const spaces = Math.max(1, Math.floor(Number(capacityTotal) || 1));
        if (spaces >= 4) {
            setPendingSpacesChoice("4plus");
            setPendingSpacesCustom(String(spaces));
            return;
        }
        setPendingSpacesChoice(String(spaces) as SpaceChoice);
        setPendingSpacesCustom("4");
    }, [capacityTotal]);

    useEffect(() => {
        if (mode === "free") {
            setAllowPoints(false);
            setPrice("0");
            return;
        }
        if (mode === "auction") {
            setPrice("0");
            if (!auctionStartPrice || Number(auctionStartPrice) < MIN_AUCTION_START_PRICE_GBP) {
                setAuctionStartPrice(DEFAULT_AUCTION_START_PRICE);
            }
            return;
        }
        if (!price || Number(price) <= 0) {
            setPrice("5");
        }
    }, [mode]);

    useEffect(() => {
        if (allowPoints && (!pointsCost || Number(pointsCost) < MIN_POINTS_COST)) {
            setPointsCost(DEFAULT_POINTS_COST);
        }
    }, [allowPoints, pointsCost]);

    useEffect(() => {
        if (!spacesSheetOpen && !customSheetOpen && !confirmSheetOpen) return;
        const onEscape = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            setSpacesSheetOpen(false);
            setCustomSheetOpen(false);
            setConfirmSheetOpen(false);
        };
        window.addEventListener("keydown", onEscape);
        return () => window.removeEventListener("keydown", onEscape);
    }, [spacesSheetOpen, customSheetOpen, confirmSheetOpen]);

    function applyPickedLocation(nextLat: number, nextLng: number, nextAddress?: string) {
        setLat(nextLat.toFixed(6));
        setLng(nextLng.toFixed(6));
        if (nextAddress) setAddressText(nextAddress);
    }

    async function onAddressSearchClick() {
        const query = addressText.trim();
        if (query.length < 3) {
            setAddressSearchMessage("Enter at least 3 characters to search.");
            return;
        }

        setAddressSearchBusy(true);
        setAddressSearchMessage("");

        try {
            const params = new URLSearchParams({
                format: "jsonv2",
                limit: "6",
                addressdetails: "1",
                countrycodes: "gb",
                viewbox: LONDON_VIEWBOX,
                q: query,
            });
            const lookup = await apiGet<{ suggestions: GeocodeSuggestion[] }>(
                `/parking-spots/geocode/search?${params.toString()}`,
                token || undefined
            );
            const matches = Array.isArray(lookup.suggestions) ? lookup.suggestions : [];
            const first = matches[0];

            if (!first) {
                setAddressSearchMessage("No close matches found. Try adding a postcode or city.");
                return;
            }

            const nextLat = Number(first.lat);
            const nextLng = Number(first.lon);
            if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) {
                setAddressSearchMessage("Could not parse location coordinates.");
                return;
            }

            applyPickedLocation(nextLat, nextLng, first.display_name);
            setAddressSearchMessage(`${matches.length} match${matches.length === 1 ? "" : "es"} found. Showing the closest result.`);
        } catch (e: any) {
            setAddressSearchMessage(e?.message || "Address search is unavailable right now.");
        } finally {
            setAddressSearchBusy(false);
        }
    }

    function onMapPick(nextLat: number, nextLng: number) {
        applyPickedLocation(nextLat, nextLng);
        setAddressSearchMessage("Pin updated from map.");
    }

    function openSpacesSheet() {
        const spaces = Math.max(1, Math.floor(Number(capacityTotal) || 1));
        if (spaces >= 4) {
            setPendingSpacesChoice("4plus");
            setPendingSpacesCustom(String(spaces));
        } else {
            setPendingSpacesChoice(String(spaces) as SpaceChoice);
            setPendingSpacesCustom("4");
        }
        setSpacesSheetOpen(true);
    }

    function applySpacesSheet() {
        const selectedSpaces =
            pendingSpacesChoice === "4plus"
                ? Math.max(4, Math.floor(Number(pendingSpacesCustom) || 4))
                : Number(pendingSpacesChoice);

        setCapacityTotal(String(selectedSpaces));
        setSpacesSheetOpen(false);
    }

    function openCustomSheet() {
        if (customSlots.length === 0) {
            setCustomSlots([createSlot()]);
        }
        setCustomSheetOpen(true);
    }

    function updateCustomSlot(slotId: string, patch: Partial<Omit<AvailabilitySlot, "id">>) {
        setCustomSlots((prev) => prev.map((slot) => (slot.id === slotId ? { ...slot, ...patch } : slot)));
    }

    function addCustomSlot() {
        const last = customSlots[customSlots.length - 1];
        setCustomSlots((prev) => [
            ...prev,
            createSlot({ dow: last?.dow ?? 1, start: last?.start ?? "09:00", end: last?.end ?? "17:00" }),
        ]);
    }

    function removeCustomSlot(slotId: string) {
        setCustomSlots((prev) => {
            const next = prev.filter((slot) => slot.id !== slotId);
            return next.length > 0 ? next : [createSlot()];
        });
    }

    function applyCustomSheet() {
        if (!areSlotsValid(customSlots)) {
            setError("Each custom row needs a valid day and time range.");
            return;
        }
        setError("");
        setCustomSheetOpen(false);
    }

    function openImagePicker() {
        imageInputRef.current?.click();
    }

    function onImageFileChange(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith("image/")) {
            setError("Please choose an image file.");
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            const result = typeof reader.result === "string" ? reader.result : "";
            if (!result) return;
            setImageUrl(result);
            setError("");
        };
        reader.onerror = () => setError("Could not read that image file.");
        reader.readAsDataURL(file);
    }

    function clearImage() {
        setImageUrl("");
        if (imageInputRef.current) {
            imageInputRef.current.value = "";
        }
    }

    function buildAvailabilityPayload() {
        const dateFields = dateFrom || dateTo ? { date_from: dateFrom || undefined, date_to: dateTo || undefined } : {};

        if (availabilityPreset === "always") {
            return { type: "24_7", ...dateFields };
        }

        if (availabilityPreset === "weekdays" || availabilityPreset === "weekends") {
            return { type: "custom_weekly", rules: quickPresetRules(availabilityPreset), ...dateFields };
        }

        if (!areSlotsValid(customSlots)) {
            throw new Error("Each custom row needs a valid day and time range.");
        }

        const rules = customSlots.map((slot) => ({ dow: Number(slot.dow), start: slot.start, end: slot.end }));
        return { type: "custom_weekly", rules, ...dateFields };
    }

    function buildSubmitPayload() {
        const coords = parseCoordinates(lat, lng);
        const normalizedTitle = title.trim();
        const normalizedDescription = description.trim();
        const normalizedAddress = addressText.trim();

        const priceNum = Number(price || 0);
        const pointsNum = Number(pointsCost || 0);
        const auctionStartNum = Number(auctionStartPrice || 0);
        const capacityTotalNum = Math.floor(Number(capacityTotal || 1));

        if (normalizedTitle.length < 3) {
            setError("Listing name must be at least 3 characters.");
            return null;
        }

        if (normalizedDescription.length > 0 && normalizedDescription.length < 5) {
            setError("Description should be at least 5 characters, or leave it empty.");
            return null;
        }

        if (!coords) {
            setError("Pick a valid map point for latitude and longitude.");
            return null;
        }

        if (normalizedAddress.length < 5) {
            setError("Address must be at least 5 characters.");
            return null;
        }

        if (!Number.isInteger(capacityTotalNum) || capacityTotalNum <= 0) {
            setError("Spaces must be at least 1.");
            return null;
        }

        if (mode === "rent" && (!Number.isFinite(priceNum) || priceNum <= 0)) {
            setError("Rent listings need a price above 0.");
            return null;
        }

        if (mode === "auction" && (!Number.isFinite(auctionStartNum) || auctionStartNum < MIN_AUCTION_START_PRICE_GBP)) {
            setError("Auction start price must be at least GBP 0.10.");
            return null;
        }

        if (allowPoints && (!Number.isFinite(pointsNum) || pointsNum < MIN_POINTS_COST)) {
            setError("Points cost must be at least 1 when enabled.");
            return null;
        }

        if (dateFrom && dateTo && dateFrom > dateTo) {
            setError("Availability end date must be after start date.");
            return null;
        }

        let availability;
        try {
            availability = buildAvailabilityPayload();
        } catch (e: any) {
            setError(e?.message || "Availability is invalid.");
            return null;
        }

        const payload: Record<string, any> = {
            title: normalizedTitle,
            description: normalizedDescription || "No description provided.",
            mode,
            price_gbp: mode === "rent" ? priceNum : 0,
            price_unit: priceUnit,
            allow_points: mode === "free" ? false : allowPoints,
            points_cost: mode === "free" ? 0 : allowPoints ? pointsNum : 0,
            address_text: normalizedAddress,
            lat: coords.lat,
            lng: coords.lng,
            image_url: imageUrl.trim() || null,
            availability,
            parking_type: "private",
            capacity_total: capacityTotalNum,
            capacity_available: capacityTotalNum,
        };

        if (mode === "auction") {
            if (!dateFrom || !dateTo) {
                setError("Auction listings need availability start and end dates.");
                return null;
            }
            payload.auction_start_price_gbp = auctionStartNum;
        }

        return payload;
    }

    async function submitListing() {
        if (!token) {
            setError("Please sign in to continue.");
            return;
        }

        setError("");

        const payload = buildSubmitPayload();
        if (!payload) return;

        if (isEdit && editId) {
            setSaving(true);
            try {
                await apiPatch<{ parking_spot: ParkingSpot }>(`/parking-spots/${editId}`, payload, token);
                setConfirmSheetOpen(false);
                navigate("/", { replace: true });
            } catch (e: any) {
                setError(e?.message || "Failed to save listing.");
            } finally {
                setSaving(false);
            }
            return;
        }

        setSaving(true);
        try {
            await apiPost<{ parking_spot: ParkingSpot }>("/parking-spots", payload, token);
            setConfirmSheetOpen(false);
            navigate("/", { replace: true });
        } catch (e: any) {
            setError(e?.message || "Failed to publish listing.");
        } finally {
            setSaving(false);
        }
    }

    const setupCapacity = Math.max(0, Math.floor(Number(capacityTotal) || 0));
    const titleValid = title.trim().length >= 3;
    const descriptionValid = description.trim().length === 0 || description.trim().length >= 5;
    const capacityValid = setupCapacity >= 1;

    const rentPriceValid = mode !== "rent" || Number(price) > 0;
    const auctionPriceValid = mode !== "auction" || Number(auctionStartPrice) >= MIN_AUCTION_START_PRICE_GBP;
    const pointsValid = !allowPoints || Number(pointsCost) >= MIN_POINTS_COST;
    const pricingValid = rentPriceValid && auctionPriceValid && pointsValid;

    const dateRangeValid = !dateFrom || !dateTo || dateFrom <= dateTo;
    const customSlotsValid = availabilityPreset !== "custom" || areSlotsValid(customSlots);
    const availabilityValid = dateRangeValid && customSlotsValid;

    const addressValid = addressText.trim().length >= 5;
    const hasCoordinates = Boolean(parsedCoords);
    const locationValid = addressValid && hasCoordinates;
    const publishReady = titleValid && descriptionValid && pricingValid && availabilityValid && locationValid;

    const stepReady: Record<WizardStep, boolean> = {
        1: capacityValid,
        2: titleValid && descriptionValid,
        3: pricingValid,
        4: availabilityValid,
        5: locationValid,
        6: publishReady,
    };

    const pricingIssue = !rentPriceValid
        ? "Rent listings need a valid price above 0."
        : !auctionPriceValid
            ? "Auction start price must be at least GBP 0.10."
            : !pointsValid
                ? "Points cost must be at least 1."
                : "";

    const availabilityIssue = !dateRangeValid
        ? "End date must be after start date."
        : !customSlotsValid
            ? "Each custom row needs a valid day and time range."
            : "";

    const stepHint =
        activeStep === 2
            ? !titleValid
                ? "Add a listing name with at least 3 characters."
                : !descriptionValid
                    ? "Description should be at least 5 characters, or leave it empty."
                    : ""
            : activeStep === 3
                ? pricingIssue
                : activeStep === 4
                    ? availabilityIssue
                    : activeStep === 5
                        ? !addressValid
                            ? "Add an address with at least 5 characters."
                            : !hasCoordinates
                                ? "Set a map pin so drivers can find your listing."
                                : ""
                        : "";

    const currentStepReady = stepReady[activeStep];

    const priceSummary =
        mode === "rent"
            ? `GBP ${Number(price || 0).toFixed(2)} / ${priceUnit}`
            : mode === "auction"
                ? `Bid from GBP ${Number(auctionStartPrice || 0).toFixed(2)} / hour`
                : "Free listing";
    const customSummary = customSlots
        .map((slot) => `${DAY_LABELS[slot.dow]} ${slot.start}-${slot.end}`)
        .slice(0, 2)
        .join(" | ");

    function goNext() {
        if (!currentStepReady) return;
        if (activeStep === 6) {
            setError("");
            setConfirmSheetOpen(true);
            return;
        }
        if (activeStep >= STEP_COUNT) return;
        setError("");
        setActiveStep((prev) => Math.min(STEP_COUNT, prev + 1) as WizardStep);
    }

    function goBack() {
        if (activeStep <= 1) return;
        setError("");
        setActiveStep((prev) => Math.max(1, prev - 1) as WizardStep);
    }

    function renderStepBody(step: FlowStep) {
        if (step === 2) {
            return (
                <div className="stack">
                    <label>
                        <span>Listing name</span>
                        <input
                            className="input"
                            value={title}
                            onChange={(event) => setTitle(event.target.value)}
                            placeholder="Example: Secure driveway near station"
                        />
                        <div className="createFieldHint">Use a clear name drivers can scan quickly.</div>
                        {!titleValid && title.length > 0 && <div className="createInlineError">Use at least 3 characters.</div>}
                    </label>

                    <label>
                        <span>Description (optional)</span>
                        <textarea
                            className="input"
                            rows={5}
                            value={description}
                            onChange={(event) => setDescription(event.target.value)}
                            placeholder="Access notes, gate details, size limits, and nearby landmarks."
                        />
                        <div className="createFieldHint">Leave blank, or write at least 5 characters.</div>
                        {!descriptionValid && description.length > 0 && (
                            <div className="createInlineError">Use at least 5 characters, or leave blank.</div>
                        )}
                    </label>
                </div>
            );
        }

        if (step === 3) {
            return (
                <div className="wizardSection">
                    <div className="wizardSectionHead">
                        <div className="wizardSubTitle">Pricing setup</div>
                        <Tooltip
                            label="Pricing help"
                            text="Rent uses fixed prices. Auction accepts driver offers that you approve."
                        />
                    </div>

                    {mode === "rent" && (
                        <div className="wizardFieldGrid wizardFieldGrid--compact">
                            <label>
                                <span>Price unit</span>
                                <div className="createSegmented" role="radiogroup" aria-label="Price unit">
                                    {PRICE_UNIT_CHOICES.map((unit) => (
                                        <button
                                            key={unit.id}
                                            type="button"
                                            className={`createSegmentedBtn createSegmentedBtn--${unit.id}${priceUnit === unit.id ? " is-active" : ""}`}
                                            aria-pressed={priceUnit === unit.id}
                                            onClick={() => setPriceUnit(unit.id)}
                                        >
                                            {unit.label}
                                        </button>
                                    ))}
                                </div>
                            </label>

                            <label>
                                <span>Price (GBP)</span>
                                <input
                                    className="input"
                                    type="number"
                                    min="0"
                                    step="0.5"
                                    value={price}
                                    onChange={(event) => setPrice(event.target.value)}
                                />
                            </label>
                        </div>
                    )}

                    {mode === "auction" && (
                        <label>
                            <span>Starting bid per hour (GBP)</span>
                            <input
                                className="input"
                                type="number"
                                min="0.1"
                                step="0.1"
                                value={auctionStartPrice}
                                onChange={(event) => setAuctionStartPrice(event.target.value)}
                            />
                            <div className="createFieldHint">Auction closes when the listing end date is reached.</div>
                        </label>
                    )}

                    {mode === "free" && <div className="wizardInlineText">Free listing selected, so no money price is required.</div>}

                    <div className="wizardPointsRow">
                        <label className={`createSwitch${mode === "free" ? " is-disabled" : ""}`}>
                            <input
                                type="checkbox"
                                checked={allowPoints}
                                onChange={(event) => setAllowPoints(event.target.checked)}
                                disabled={mode === "free"}
                            />
                            <span className="createSwitchTrack" aria-hidden="true" />
                            <span className="createSwitchLabel">Allow points payment</span>
                        </label>

                        {allowPoints && mode !== "free" && (
                            <label className="wizardPointsInput">
                                <span>Points cost</span>
                                <input
                                    className="input"
                                    type="number"
                                    min="1"
                                    step="1"
                                    value={pointsCost}
                                    onChange={(event) => setPointsCost(event.target.value)}
                                />
                            </label>
                        )}
                    </div>

                    {pricingIssue && <div className="createInlineError">{pricingIssue}</div>}
                </div>
            );
        }

        if (step === 4) {
            return (
                <div className="wizardSection">
                    <div className="wizardSectionHead">
                        <div className="wizardSubTitle">Availability style</div>
                        <Tooltip
                            label="Availability help"
                            text="Pick a quick preset or choose custom day and time windows."
                        />
                    </div>

                    <div className="wizardQuickGrid">
                        {AVAILABILITY_CHOICES.map((choice) => (
                            <button
                                key={choice.id}
                                type="button"
                                className={`wizardQuickCard wizardQuickCard--${choice.tone}${availabilityPreset === choice.id ? " is-active" : ""}`}
                                onClick={() => setAvailabilityPreset(choice.id)}
                                aria-pressed={availabilityPreset === choice.id}
                            >
                                <span className="wizardQuickTitle">{choice.title}</span>
                                <span className="wizardQuickCopy">{choice.copy}</span>
                            </button>
                        ))}
                    </div>

                    <div className="wizardFieldGrid wizardFieldGrid--compact">
                        <label>
                            <span>Start date</span>
                            <input className="input" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
                        </label>

                        <label>
                            <span>End date</span>
                            <input className="input" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
                        </label>
                    </div>

                    {availabilityPreset === "custom" && (
                        <div className="wizardInlineRow">
                            <div>
                                <div className="wizardInlineTitle">Custom schedule</div>
                                <div className="wizardInlineValue">{customSummary || "No custom slots set yet"}</div>
                            </div>
                            <button type="button" className="btn" onClick={openCustomSheet}>
                                Edit custom times
                            </button>
                        </div>
                    )}

                    {availabilityIssue && <div className="createInlineError">{availabilityIssue}</div>}
                </div>
            );
        }

        if (step === 5) {
            return (
                <>
                    <div className="addressLookupWrap">
                        <label>
                            <span>Address</span>
                            <div className="addressInputRow">
                                <input
                                    className="input"
                                    value={addressText}
                                    onChange={(event) => {
                                        setAddressText(event.target.value);
                                        setAddressSearchMessage("");
                                    }}
                                    onKeyDown={(event) => {
                                        if (event.key !== "Enter") return;
                                        event.preventDefault();
                                        void onAddressSearchClick();
                                    }}
                                    placeholder="Start typing an address (for example 295 Upper Street)"
                                    autoComplete="off"
                                />
                                <button
                                    type="button"
                                    className="btn btn-primary addressSearchBtn"
                                    disabled={addressSearchBusy}
                                    onClick={() => void onAddressSearchClick()}
                                >
                                    {addressSearchBusy ? "Searching..." : "Search"}
                                </button>
                            </div>
                            <div className="createFieldHint">Search to set a pin, then click map to adjust precisely.</div>
                        </label>

                        {addressSearchMessage && <div className="addressLookupStatus">{addressSearchMessage}</div>}
                    </div>

                    <div className="mapWrap mapWrap--pin wizardMap">
                        <div className="leafletShell">
                            <MapContainer key={`${mapCenter[0]}-${mapCenter[1]}`} center={mapCenter} zoom={13} className="leafletMap">
                                <TileLayer
                                    attribution="&copy; OpenStreetMap contributors"
                                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                                />
                                <MapPickerPin position={markerPosition} onPick={onMapPick} />
                            </MapContainer>
                        </div>
                    </div>

                    {(!addressValid || !hasCoordinates) && (
                        <div className="createInlineError">Add a valid address and map pin before publishing.</div>
                    )}
                </>
            );
        }

        if (step === 6) {
            return (
                <>
                    <input
                        ref={imageInputRef}
                        type="file"
                        accept="image/*"
                        className="wizardHiddenFileInput"
                        onChange={onImageFileChange}
                    />

                    <div className="wizardImageActions">
                        <button type="button" className="btn btn-primary" onClick={openImagePicker}>
                            {imageUrl.trim() ? "Change image" : "Choose image"}
                        </button>
                        {imageUrl.trim() && (
                            <button type="button" className="btn" onClick={clearImage}>
                                Remove image
                            </button>
                        )}
                    </div>

                    <div className="createFieldHint">Upload a clear photo that matches the space drivers will see.</div>

                    {imageUrl.trim() && (
                        <div className="wizardImagePreview">
                            <img src={imageUrl} alt="Listing preview" />
                        </div>
                    )}
                </>
            );
        }

        return null;
    }

    const actionHint = error || (!currentStepReady && stepHint ? stepHint : "");

    const stepNavigation = (
        <StepNavigation
            onBack={goBack}
            onNext={goNext}
            backDisabled={activeStep <= 1 || saving}
            nextDisabled={!currentStepReady || saving}
            nextLabel={activeStep === 6 ? "Publish" : "Next"}
            hint={actionHint}
        />
    );

    if (!token) {
        const next = `${location.pathname}${location.search}`;
        return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
    }

    const flowStep = activeStep as FlowStep;

    return (
        <div className="container createWizardPage">
            {loadingExisting ? (
                <div className="card formSection createFlowLocked">
                    <div className="h3">Loading listing details...</div>
                    <div className="muted">Pulling your saved information and availability settings.</div>
                </div>
            ) : (
                <form className="wizardFlow" onSubmit={(event) => event.preventDefault()}>
                    {activeStep === 1 && (
                        <section className="wizardIntro" key="wizard-step-1">
                            <div className="wizardIntroCard">
                                <div className="wizardIntroKicker">{isEdit ? "EDIT LISTING" : "CREATE LISTING"}</div>
                                <h1 className="wizardIntroTitle">What kind of listing are you creating?</h1>
                                <p className="wizardIntroSub">
                                    Pick your model first, then complete the setup in guided steps. Creating for {user?.name ?? "you"}.
                                </p>

                                <div className="wizardTileGrid">
                                    {MODEL_CHOICES.map((choice) => (
                                        <SelectionTile
                                            key={choice.mode}
                                            title={choice.title}
                                            copy={choice.copy}
                                            help={choice.help}
                                            tone={choice.tone}
                                            active={mode === choice.mode}
                                            onClick={() => setMode(choice.mode)}
                                        />
                                    ))}
                                </div>

                                <div className="wizardIntroSelected">
                                    Selected: {modeLabel(mode)} - {modeSummary(mode)}
                                </div>

                                <div className="wizardInlineRow wizardInlineRow--intro">
                                    <div>
                                        <div className="wizardInlineTitle">Spaces available</div>
                                        <div className="wizardInlineValue">
                                            {setupCapacity || 1} {setupCapacity === 1 ? "space" : "spaces"}
                                        </div>
                                    </div>
                                    <button type="button" className="btn" onClick={openSpacesSheet}>
                                        Choose spaces
                                    </button>
                                </div>

                                <div className="wizardActions wizardActions--intro">
                                    <Link className="btn" to={isEdit && editId ? `/spots/${editId}` : "/dashboard"}>
                                        Cancel
                                    </Link>
                                    <button
                                        type="button"
                                        className="btn btn-primary"
                                        onClick={goNext}
                                        disabled={!stepReady[1] || saving}
                                    >
                                        Next
                                    </button>
                                </div>
                                {error && <div className="createInlineError">{error}</div>}
                            </div>
                        </section>
                    )}

                    {activeStep > 1 && (
                        <StepShell
                            step={flowStep}
                            panel={STEP_META[flowStep]}
                            title={STEP_META[flowStep].title}
                            subtitle={STEP_META[flowStep].subtitle}
                            footer={stepNavigation}
                        >
                            {renderStepBody(flowStep)}
                        </StepShell>
                    )}
                </form>
            )}

            <WizardSheet
                open={spacesSheetOpen}
                title="Choose spaces"
                subtitle="Select how many spaces drivers can book at once."
                onClose={() => setSpacesSheetOpen(false)}
            >
                <div className="createSheetSpaceGrid">
                    {SPACE_CHOICES.map((choice) => (
                        <button
                            key={choice.id}
                            type="button"
                            className={`createSheetSpaceBtn${pendingSpacesChoice === choice.id ? " is-active" : ""}`}
                            onClick={() => setPendingSpacesChoice(choice.id)}
                        >
                            {choice.label}
                        </button>
                    ))}
                </div>

                {pendingSpacesChoice === "4plus" && (
                    <label>
                        <span>Custom spaces (4+)</span>
                        <input
                            className="input"
                            type="number"
                            min={4}
                            step={1}
                            value={pendingSpacesCustom}
                            onChange={(event) => setPendingSpacesCustom(event.target.value)}
                        />
                    </label>
                )}

                <div className="createSheetActions">
                    <button type="button" className="btn" onClick={() => setSpacesSheetOpen(false)}>
                        Cancel
                    </button>
                    <button type="button" className="btn btn-primary" onClick={applySpacesSheet}>
                        Apply spaces
                    </button>
                </div>
            </WizardSheet>

            <WizardSheet
                open={customSheetOpen}
                title="Custom availability"
                subtitle="Set day and time ranges for bookings."
                onClose={() => setCustomSheetOpen(false)}
                wide
            >
                <div className="stack">
                    {customSlots.map((slot) => (
                        <div className="customSlotCard" key={slot.id}>
                            <div className="customSlotRow">
                                <label>
                                    <span>Day</span>
                                    <select
                                        className="input"
                                        value={slot.dow}
                                        onChange={(event) => updateCustomSlot(slot.id, { dow: Number(event.target.value) })}
                                    >
                                        {DAY_LABELS.map((dayLabel, dayIndex) => (
                                            <option key={`${slot.id}-${dayLabel}`} value={dayIndex}>
                                                {dayLabel}
                                            </option>
                                        ))}
                                    </select>
                                </label>

                                <label>
                                    <span>Start</span>
                                    <input
                                        className="input"
                                        type="time"
                                        value={slot.start}
                                        onChange={(event) => updateCustomSlot(slot.id, { start: event.target.value })}
                                    />
                                </label>

                                <label>
                                    <span>End</span>
                                    <input
                                        className="input"
                                        type="time"
                                        value={slot.end}
                                        onChange={(event) => updateCustomSlot(slot.id, { end: event.target.value })}
                                    />
                                </label>

                                <button
                                    type="button"
                                    className="btn btn-ghost"
                                    onClick={() => removeCustomSlot(slot.id)}
                                    disabled={customSlots.length === 1}
                                >
                                    Remove
                                </button>
                            </div>
                        </div>
                    ))}

                    <div className="rowInline">
                        <button type="button" className="btn" onClick={addCustomSlot}>
                            + Add day window
                        </button>
                    </div>

                    {!areSlotsValid(customSlots) && (
                        <div className="createInlineError">Each row needs a valid day and time range.</div>
                    )}
                </div>

                <div className="createSheetActions">
                    <button type="button" className="btn" onClick={() => setCustomSheetOpen(false)}>
                        Cancel
                    </button>
                    <button type="button" className="btn btn-primary" onClick={applyCustomSheet}>
                        Apply custom times
                    </button>
                </div>
            </WizardSheet>

            <WizardSheet
                open={confirmSheetOpen}
                title={isEdit ? "Confirm save" : "Confirm publish"}
                subtitle="One final check before publishing. You'll return to all listings right after."
                onClose={() => {
                    setConfirmSheetOpen(false);
                    setError("");
                }}
            >
                <div className="card">
                    <div className="h3">{title || "Untitled listing"}</div>
                    <div className="muted tiny">{addressText || "Address not set"}</div>
                    <div className="rowInline tiny" style={{ marginTop: "0.45rem" }}>
                        <span>{modeLabel(mode)}</span>
                        <span>|</span>
                        <span>{priceSummary}</span>
                        <span>|</span>
                        <span>{availabilityLabel(availabilityPreset)}</span>
                    </div>
                </div>

                {error && <div className="createInlineError">{error}</div>}

                <div className="createSheetActions">
                    <button
                        type="button"
                        className="btn"
                        onClick={() => {
                            setConfirmSheetOpen(false);
                            setError("");
                        }}
                        disabled={saving}
                    >
                        Back
                    </button>
                    <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => void submitListing()}
                        disabled={!publishReady || saving}
                    >
                        {saving ? "Saving..." : isEdit ? "Save listing" : "Publish listing"}
                    </button>
                </div>
            </WizardSheet>
        </div>
    );
}
