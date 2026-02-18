import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import L from "leaflet";
import Lottie from "lottie-react";
import { MapContainer, Marker, TileLayer, useMapEvents } from "react-leaflet";
import { Link, Navigate, useBeforeUnload, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { apiGet, apiPatch, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import successAnimation from "../assets/Success.json";
import type { ParkingSpot } from "../types";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

type Mode = "free" | "rent" | "auction";
type PriceUnit = "hour" | "day" | "week";
type AvailabilityPreset = "always" | "weekdays" | "weekends" | "custom";
type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;
type FlowStep = Exclude<WizardStep, 1>;
type SpaceChoice = "1" | "2" | "3plus";
type Tone = "blue" | "lilac" | "mint" | "cream" | "sky";
type PendingLeaveAction = { kind: "link"; path: string } | { kind: "history" } | { kind: "reload" } | null;

type GeocodeSuggestion = { display_name: string; lat: string; lon: string };
type AvailabilitySlot = { id: string; dow: number; start: string; end: string };
type DraftSnapshot = { mode: Mode; title: string; description: string; capacityTotal: string; priceUnit: PriceUnit; price: string; auctionStartPrice: string; allowPoints: boolean; pointsCost: string; availabilityPreset: AvailabilityPreset; dateFrom: string; dateTo: string; customSlots: AvailabilitySlot[]; addressText: string; lat: string; lng: string; imageUrl: string };

const STEP_COUNT = 6;
const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DEFAULT_CENTER: [number, number] = [51.5074, -0.1278];
const LONDON_VIEWBOX = "-0.5103,51.6919,0.3340,51.2868";
const MIN_AUCTION_START_PRICE_GBP = 0.1;
const MIN_POINTS_COST = 1;
const DEFAULT_AUCTION_START_PRICE = String(MIN_AUCTION_START_PRICE_GBP);
const DEFAULT_POINTS_COST = String(MIN_POINTS_COST);
const LEAVE_DRAFT_MESSAGE = "Are you sure you want to leave? Changes will not be saved.";
const DRAFT_STORAGE_KEY = "parkingbuddies:create-listing-draft:v1";

type StoredDraft = {
    editId: string | null;
    activeStep: WizardStep;
    baselineSignature: string;
    snapshot: DraftSnapshot;
};

const SPACE_CHOICES: Array<{ id: SpaceChoice; label: string; value: number }> = [
    { id: "1", label: "1 space", value: 1 },
    { id: "2", label: "2 spaces", value: 2 },
    { id: "3plus", label: "3+ spaces", value: 4 },
];

const MODEL_CHOICES: Array<{ mode: Mode; title: string; copy: string; tone: Tone; help: string }> = [
    { mode: "rent", title: "Rent", copy: "Fixed pricing for instant bookings.", tone: "blue", help: "Drivers can book instantly at the rate you set." },
    { mode: "auction", title: "Auction", copy: "Drivers submit offers. You get to approve.", tone: "lilac", help: "Drivers send offers and you decide which bid to accept." },
    { mode: "free", title: "Free", copy: "No payment required for this listing.", tone: "mint", help: "Bookings are free to drivers and no payment is collected." },
];

const STEP_META: Record<FlowStep, { panelTitle: string; panelCopy: string; panelTone: Tone; title: string; subtitle: string }> = {
    2: { panelTitle: "Basics", panelCopy: "Set the core details so drivers quickly understand your space.", panelTone: "blue", title: "Listing basics", subtitle: "Keep this short, clear, and practical." },
    3: { panelTitle: "Pricing", panelCopy: "Choose a simple pricing setup that matches your listing model.", panelTone: "mint", title: "Pricing", subtitle: "Set how drivers pay for this listing." },
    4: { panelTitle: "Availability", panelCopy: "Define when drivers can request or book this space.", panelTone: "lilac", title: "Availability", subtitle: "Choose quick presets or custom day and time windows." },
    5: { panelTitle: "Location", panelCopy: "Add a searchable address and confirm the exact map pin.", panelTone: "cream", title: "Location", subtitle: "Search once, then fine-tune by tapping on the map." },
    6: { panelTitle: "Images", panelCopy: "A clear image improves trust and click-through for drivers.", panelTone: "sky", title: "Images", subtitle: "Optional, but strongly recommended." },
};

const AVAILABILITY_CHOICES: Array<{ id: AvailabilityPreset; title: string; copy: string; tone: "blue" | "lilac" | "mint" | "cream" }> = [
    { id: "always", title: "24/7", copy: "Always available", tone: "blue" },
    { id: "weekdays", title: "Weekdays", copy: "Mon-Fri", tone: "lilac" },
    { id: "weekends", title: "Weekends", copy: "Sat-Sun", tone: "mint" },
    { id: "custom", title: "Custom", copy: "Choose days and times", tone: "cream" },
];

const PRICE_UNIT_CHOICES: Array<{ id: PriceUnit; label: string }> = [{ id: "hour", label: "Hourly" }, { id: "day", label: "Daily" }, { id: "week", label: "Weekly" }];

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
    return mode === "rent" ? "Rent" : mode === "auction" ? "Auction" : "Free";
}

function availabilityLabel(preset: AvailabilityPreset) {
    return preset === "always" ? "24/7" : preset === "weekdays" ? "Weekdays" : preset === "weekends" ? "Weekends" : "Custom";
}

function draftSignature(snapshot: DraftSnapshot) {
    return JSON.stringify({
        mode: snapshot.mode,
        title: snapshot.title.trim(),
        description: snapshot.description.trim(),
        capacityTotal: String(Math.max(1, Math.floor(Number(snapshot.capacityTotal) || 1))),
        priceUnit: snapshot.priceUnit,
        price: Number(snapshot.price || 0),
        auctionStartPrice: Number(snapshot.auctionStartPrice || 0),
        allowPoints: Boolean(snapshot.allowPoints),
        pointsCost: Number(snapshot.pointsCost || 0),
        availabilityPreset: snapshot.availabilityPreset,
        dateFrom: snapshot.dateFrom || "",
        dateTo: snapshot.dateTo || "",
        customSlots: snapshot.customSlots.map((slot) => ({
            dow: Number(slot.dow),
            start: slot.start,
            end: slot.end,
        })),
        addressText: snapshot.addressText.trim(),
        lat: String(snapshot.lat),
        lng: String(snapshot.lng),
        imageUrl: snapshot.imageUrl.trim(),
    });
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
    return (preset === "weekdays" ? [1, 2, 3, 4, 5] : [0, 6]).map((dow) => ({ dow, start: "00:00", end: "23:59" }));
}

function stepFromUnknown(value: unknown): WizardStep {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 1;
    if (numeric <= 1) return 1;
    if (numeric >= STEP_COUNT) return STEP_COUNT as WizardStep;
    return Math.floor(numeric) as WizardStep;
}

function readStoredDraft(expectedEditId: string | null): StoredDraft | null {
    try {
        const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
        if (!raw) return null;

        const parsed = JSON.parse(raw) as Partial<StoredDraft>;
        if ((parsed.editId ?? null) !== expectedEditId) return null;
        if (!parsed.snapshot || typeof parsed.snapshot !== "object") return null;

        const snapshot = parsed.snapshot as Partial<DraftSnapshot>;
        const normalizedSnapshot: DraftSnapshot = {
            mode: snapshot.mode === "auction" || snapshot.mode === "free" ? snapshot.mode : "rent",
            title: typeof snapshot.title === "string" ? snapshot.title : "",
            description: typeof snapshot.description === "string" ? snapshot.description : "",
            capacityTotal: typeof snapshot.capacityTotal === "string" ? snapshot.capacityTotal : "1",
            priceUnit:
                snapshot.priceUnit === "day" || snapshot.priceUnit === "week" ? snapshot.priceUnit : "hour",
            price: typeof snapshot.price === "string" ? snapshot.price : "5",
            auctionStartPrice:
                typeof snapshot.auctionStartPrice === "string"
                    ? snapshot.auctionStartPrice
                    : DEFAULT_AUCTION_START_PRICE,
            allowPoints: Boolean(snapshot.allowPoints),
            pointsCost: typeof snapshot.pointsCost === "string" ? snapshot.pointsCost : DEFAULT_POINTS_COST,
            availabilityPreset:
                snapshot.availabilityPreset === "weekdays" ||
                snapshot.availabilityPreset === "weekends" ||
                snapshot.availabilityPreset === "custom"
                    ? snapshot.availabilityPreset
                    : "always",
            dateFrom: typeof snapshot.dateFrom === "string" ? snapshot.dateFrom : dateFromToday(0),
            dateTo: typeof snapshot.dateTo === "string" ? snapshot.dateTo : dateFromToday(3),
            customSlots:
                Array.isArray(snapshot.customSlots) && snapshot.customSlots.length > 0
                    ? snapshot.customSlots.map((slot) =>
                          createSlot({
                              dow: Number.isInteger(Number(slot?.dow)) ? Number(slot?.dow) : 1,
                              start: typeof slot?.start === "string" ? slot.start : "09:00",
                              end: typeof slot?.end === "string" ? slot.end : "17:00",
                          })
                      )
                    : [createSlot()],
            addressText: typeof snapshot.addressText === "string" ? snapshot.addressText : "",
            lat: typeof snapshot.lat === "string" ? snapshot.lat : String(DEFAULT_CENTER[0]),
            lng: typeof snapshot.lng === "string" ? snapshot.lng : String(DEFAULT_CENTER[1]),
            imageUrl: typeof snapshot.imageUrl === "string" ? snapshot.imageUrl : "",
        };

        return {
            editId: expectedEditId,
            activeStep: stepFromUnknown(parsed.activeStep),
            baselineSignature: typeof parsed.baselineSignature === "string" ? parsed.baselineSignature : "",
            snapshot: normalizedSnapshot,
        };
    } catch {
        return null;
    }
}

function MapPickerPin({ position, onPick }: { position: [number, number] | null; onPick: (lat: number, lng: number) => void }) {
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
            <button
                type="button"
                className="wizardTooltipBtn"
                aria-label={label}
                title={text}
                onClick={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
            >
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
    spacesLabel,
    onEditSpaces,
}: {
    title: string;
    copy: string;
    help: string;
    tone: Tone;
    active: boolean;
    onClick: () => void;
    spacesLabel?: string;
    onEditSpaces?: () => void;
}) {
    return (
        <article
            className={`wizardTile wizardTile--${tone}${active ? " is-active" : ""}`}
            role="button"
            tabIndex={0}
            aria-pressed={active}
            onClick={onClick}
            onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onClick();
            }}
        >
            <div className="wizardTileSelect">
                <div className="wizardTileHead">
                    <Tooltip label={`${title} mode help`} text={help} />
                </div>
                <span className="wizardTileTitle">{title}</span>
                <span className="wizardTileCopy">{copy}</span>
            </div>

            {active && onEditSpaces && spacesLabel && (
                <div className="wizardTileSpotsRow">
                    <span className="wizardTileSpotsValue">{spacesLabel}</span>
                    <button
                        type="button"
                        className="btn wizardTileSpotsBtn"
                        onClick={(event) => {
                            event.stopPropagation();
                            onEditSpaces();
                        }}
                    >
                        Edit spots
                    </button>
                </div>
            )}
        </article>
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
    const [pendingSpacesCustom, setPendingSpacesCustom] = useState("3");

    const [customSheetOpen, setCustomSheetOpen] = useState(false);

    const [confirmSheetOpen, setConfirmSheetOpen] = useState(false);
    const [leaveSheetOpen, setLeaveSheetOpen] = useState(false);
    const [pendingLeaveAction, setPendingLeaveAction] = useState<PendingLeaveAction>(null);

    const [loadingExisting, setLoadingExisting] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [publishingOverlayOpen, setPublishingOverlayOpen] = useState(false);
    const [baselineSignature, setBaselineSignature] = useState("");
    const suppressNextPopGuardRef = useRef(false);
    const successTimerRef = useRef<number | null>(null);

    const imageInputRef = useRef<HTMLInputElement | null>(null);

    const parsedCoords = parseCoordinates(lat, lng);
    const mapCenter: [number, number] = parsedCoords ? [parsedCoords.lat, parsedCoords.lng] : DEFAULT_CENTER;
    const markerPosition: [number, number] | null = parsedCoords ? [parsedCoords.lat, parsedCoords.lng] : null;
    const draftSnapshot: DraftSnapshot = useMemo(
        () => ({
            mode,
            title,
            description,
            capacityTotal,
            priceUnit,
            price,
            auctionStartPrice,
            allowPoints,
            pointsCost,
            availabilityPreset,
            dateFrom,
            dateTo,
            customSlots,
            addressText,
            lat,
            lng,
            imageUrl,
        }),
        [
            mode,
            title,
            description,
            capacityTotal,
            priceUnit,
            price,
            auctionStartPrice,
            allowPoints,
            pointsCost,
            availabilityPreset,
            dateFrom,
            dateTo,
            customSlots,
            addressText,
            lat,
            lng,
            imageUrl,
        ]
    );
    const currentSignature = draftSignature(draftSnapshot);
    const hasUnsavedChanges = baselineSignature !== "" && currentSignature !== baselineSignature;

    function applySnapshot(snapshot: DraftSnapshot) {
        setMode(snapshot.mode);
        setTitle(snapshot.title);
        setDescription(snapshot.description);
        setCapacityTotal(snapshot.capacityTotal);
        setPriceUnit(snapshot.priceUnit);
        setPrice(snapshot.price);
        setAuctionStartPrice(snapshot.auctionStartPrice);
        setAllowPoints(snapshot.allowPoints);
        setPointsCost(snapshot.pointsCost);
        setAvailabilityPreset(snapshot.availabilityPreset);
        setDateFrom(snapshot.dateFrom);
        setDateTo(snapshot.dateTo);
        setCustomSlots(snapshot.customSlots);
        setAddressText(snapshot.addressText);
        setLat(snapshot.lat);
        setLng(snapshot.lng);
        setImageUrl(snapshot.imageUrl);
    }

    useBeforeUnload(
        (event) => {
            if (!hasUnsavedChanges || saving) return;
            event.preventDefault();
            event.returnValue = "";
        },
        { capture: true }
    );

    useEffect(() => {
        if (!hasUnsavedChanges || saving) return;

        const onDocumentClick = (event: MouseEvent) => {
            if (event.defaultPrevented) return;
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

            const source = event.target as Element | null;
            const anchor = source?.closest?.("a[href]") as HTMLAnchorElement | null;
            if (!anchor) return;
            if (anchor.target && anchor.target !== "_self") return;
            if (anchor.hasAttribute("download")) return;

            const href = anchor.getAttribute("href");
            if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;

            let nextUrl: URL;
            try {
                nextUrl = new URL(anchor.href, window.location.href);
            } catch {
                return;
            }

            if (nextUrl.origin !== window.location.origin) return;

            const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
            const nextPath = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
            if (currentPath === nextPath) return;

            event.preventDefault();
            event.stopPropagation();
            setPendingLeaveAction({ kind: "link", path: nextPath });
            setLeaveSheetOpen(true);
        };

        const onPopState = () => {
            if (suppressNextPopGuardRef.current) {
                suppressNextPopGuardRef.current = false;
                return;
            }
            suppressNextPopGuardRef.current = true;
            window.history.go(1);
            setPendingLeaveAction({ kind: "history" });
            setLeaveSheetOpen(true);
        };

        const onReloadShortcut = (event: KeyboardEvent) => {
            const key = event.key.toLowerCase();
            const wantsReload = key === "f5" || ((event.ctrlKey || event.metaKey) && key === "r");
            if (!wantsReload) return;
            event.preventDefault();
            event.stopPropagation();
            setPendingLeaveAction({ kind: "reload" });
            setLeaveSheetOpen(true);
        };

        document.addEventListener("click", onDocumentClick, true);
        window.addEventListener("popstate", onPopState);
        window.addEventListener("keydown", onReloadShortcut, true);
        return () => {
            document.removeEventListener("click", onDocumentClick, true);
            window.removeEventListener("popstate", onPopState);
            window.removeEventListener("keydown", onReloadShortcut, true);
        };
    }, [hasUnsavedChanges, saving]);

    useEffect(() => {
        setBaselineSignature("");
    }, [editId]);

    useEffect(() => {
        if (isEdit) return;
        const stored = readStoredDraft(null);
        if (!stored) return;
        applySnapshot(stored.snapshot);
        setActiveStep(stored.activeStep);
        setBaselineSignature(stored.baselineSignature);
    }, [isEdit]);

    useEffect(() => {
        if (isEdit || loadingExisting || baselineSignature) return;
        setBaselineSignature(currentSignature);
    }, [isEdit, loadingExisting, baselineSignature, currentSignature]);

    useEffect(() => {
        return () => {
            if (successTimerRef.current != null) {
                window.clearTimeout(successTimerRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (!isEdit || !token || !editId) return;

        const stored = readStoredDraft(editId);
        if (stored) {
            applySnapshot(stored.snapshot);
            setActiveStep(stored.activeStep);
            setBaselineSignature(stored.baselineSignature);
            return;
        }

        let active = true;
        setLoadingExisting(true);
        setError("");

        apiGet<{ parking_spot: ParkingSpot }>(`/parking-spots/${editId}`, token)
            .then((res) => {
                if (!active) return;
                const listing = res.parking_spot;
                const av = (listing.availability_json ?? null) as any;
                const nextMode = (listing.mode as Mode) ?? "rent";
                const nextTitle = listing.title ?? "";
                const nextDescription = listing.description ?? "";
                const nextPrice = listing.mode === "rent" ? String(listing.price_gbp ?? "") : "";
                const nextPriceUnit = (listing.price_unit as PriceUnit) ?? "hour";
                const nextAllowPoints = Boolean(listing.allow_points);
                const nextPointsCost = String(listing.points_cost ?? DEFAULT_POINTS_COST);
                const nextAuctionStartPrice =
                    listing.auction_start_price_gbp == null
                        ? DEFAULT_AUCTION_START_PRICE
                        : String(listing.auction_start_price_gbp);
                const nextCapacityTotal = String(listing.capacity_total ?? 1);
                const nextAddressText = listing.address_text ?? "";
                const nextLat = String(listing.lat ?? "");
                const nextLng = String(listing.lng ?? "");
                const nextImageUrl = listing.image_url ?? "";
                const nextDateFrom = typeof av?.date_from === "string" ? av.date_from : dateFromToday(0);
                const nextDateTo = typeof av?.date_to === "string" ? av.date_to : dateFromToday(3);

                let nextAvailabilityPreset: AvailabilityPreset = "always";
                let nextCustomSlots: AvailabilitySlot[] = [createSlot()];

                if (av?.type === "custom_weekly") {
                    nextAvailabilityPreset = "custom";
                    nextCustomSlots = parseAvailabilityRules(av?.rules);
                } else if (av?.type === "same_everyday") {
                    const start = typeof av?.start === "string" && isTime(av.start) ? av.start : "09:00";
                    const end = typeof av?.end === "string" && isTime(av.end) ? av.end : "17:00";
                    nextAvailabilityPreset = "custom";
                    nextCustomSlots = [0, 1, 2, 3, 4, 5, 6].map((dow) => createSlot({ dow, start, end }));
                }

                const nextSnapshot: DraftSnapshot = {
                    mode: nextMode,
                    title: nextTitle,
                    description: nextDescription,
                    capacityTotal: nextCapacityTotal,
                    priceUnit: nextPriceUnit,
                    price: nextPrice,
                    auctionStartPrice: nextAuctionStartPrice,
                    allowPoints: nextAllowPoints,
                    pointsCost: nextPointsCost,
                    availabilityPreset: nextAvailabilityPreset,
                    dateFrom: nextDateFrom,
                    dateTo: nextDateTo,
                    customSlots: nextCustomSlots,
                    addressText: nextAddressText,
                    lat: nextLat,
                    lng: nextLng,
                    imageUrl: nextImageUrl,
                };

                applySnapshot(nextSnapshot);
                setBaselineSignature(draftSignature(nextSnapshot));
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
            setPendingSpacesChoice("3plus");
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
        if (loadingExisting) return;
        const payload: StoredDraft = {
            editId,
            activeStep,
            baselineSignature,
            snapshot: draftSnapshot,
        };
        try {
            window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(payload));
        } catch {
            // localStorage unavailable; skip draft persistence quietly
        }
    }, [editId, activeStep, baselineSignature, currentSignature, draftSnapshot, loadingExisting]);

    useEffect(() => {
        if (!spacesSheetOpen && !customSheetOpen && !confirmSheetOpen && !leaveSheetOpen) return;
        const onEscape = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            setSpacesSheetOpen(false);
            setCustomSheetOpen(false);
            setConfirmSheetOpen(false);
            setLeaveSheetOpen(false);
            setPendingLeaveAction(null);
        };
        window.addEventListener("keydown", onEscape);
        return () => window.removeEventListener("keydown", onEscape);
    }, [spacesSheetOpen, customSheetOpen, confirmSheetOpen, leaveSheetOpen]);

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
            setPendingSpacesChoice("3plus");
            setPendingSpacesCustom(String(spaces));
        } else {
            setPendingSpacesChoice(String(spaces) as SpaceChoice);
            setPendingSpacesCustom("4");
        }
        setSpacesSheetOpen(true);
    }

    function applySpacesSheet() {
        const selectedSpaces =
            pendingSpacesChoice === "3plus"
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

    function showPublishSuccess(nextPath: string) {
        if (successTimerRef.current != null) {
            window.clearTimeout(successTimerRef.current);
        }
        setPublishingOverlayOpen(true);
        successTimerRef.current = window.setTimeout(() => {
            setPublishingOverlayOpen(false);
            navigate(nextPath, { replace: true });
        }, 4000);
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

        setSaving(true);
        try {
            const response =
                isEdit && editId
                    ? await apiPatch<{ parking_spot: ParkingSpot }>(`/parking-spots/${editId}`, payload, token)
                    : await apiPost<{ parking_spot: ParkingSpot }>("/parking-spots", payload, token);
            const nextId = response.parking_spot?.id || editId;
            setBaselineSignature(currentSignature);
            setConfirmSheetOpen(false);
            try {
                window.localStorage.removeItem(DRAFT_STORAGE_KEY);
            } catch {
                // ignore storage errors
            }
            showPublishSuccess(nextId ? `/spots/${nextId}` : "/dashboard");
        } catch (e: any) {
            setError(e?.message || (isEdit ? "Failed to save listing." : "Failed to publish listing."));
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

    const stepHintByStep: Record<WizardStep, string> = {
        1: "",
        2: !titleValid
            ? "Add a listing name with at least 3 characters."
            : !descriptionValid
                ? "Description should be at least 5 characters, or leave it empty."
                : "",
        3: pricingIssue,
        4: availabilityIssue,
        5: !addressValid ? "Add an address with at least 5 characters." : !hasCoordinates ? "Set a map pin so drivers can find your listing." : "",
        6: "",
    };
    const stepHint = stepHintByStep[activeStep];

    const currentStepReady = stepReady[activeStep];

    const priceSummary =
        mode === "rent"
            ? `GBP ${Number(price || 0).toFixed(2)} / ${priceUnit}`
            : mode === "auction"
                ? `Bid from GBP ${Number(auctionStartPrice || 0).toFixed(2)} / hour`
                : "Free listing";
    const customSummary = customSlots
        .map((slot) => `${DAY_LABELS[slot.dow]} ${slot.start}-${slot.end}`)
        .join(" | ");
    const availabilitySummary =
        availabilityPreset === "custom" ? customSummary || "Custom schedule not set" : availabilityLabel(availabilityPreset);
    const confirmRows: Array<{ label: string; value: string }> = [
        { label: "Model", value: modeLabel(mode) },
        { label: "Spaces", value: `${setupCapacity || 1} ${setupCapacity === 1 ? "space" : "spaces"}` },
        { label: "Pricing", value: priceSummary },
        { label: "Availability", value: availabilitySummary },
        { label: "Address", value: addressText.trim() || "Address not set" },
    ];

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

    function stayOnPage() {
        setLeaveSheetOpen(false);
        setPendingLeaveAction(null);
    }

    function leavePage() {
        const action = pendingLeaveAction;
        setLeaveSheetOpen(false);
        setPendingLeaveAction(null);

        if (!action) return;
        if (action.kind === "link") {
            navigate(action.path);
            return;
        }
        if (action.kind === "reload") {
            window.location.reload();
            return;
        }

        suppressNextPopGuardRef.current = true;
        window.history.back();
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
                <div className="wizardSection wizardSection--pricing">
                    <div className="wizardSectionHead">
                        <div className="wizardSubTitle">Pricing setup</div>
                        <Tooltip
                            label="Pricing help"
                            text="Rent uses fixed prices. Auction accepts driver offers that you approve."
                        />
                    </div>

                    {mode === "rent" && (
                        <div className="wizardPointsRow wizardPointsRow--pricing wizardPricingRow">
                            <label className="wizardPricingAmount">
                                <span>Price (GBP)</span>
                                <input
                                    className="input wizardPricingInput"
                                    type="number"
                                    min="0"
                                    step="0.5"
                                    value={price}
                                    onChange={(event) => setPrice(event.target.value)}
                                />
                            </label>

                            <label className="wizardPricingUnit">
                                <span>Charge by</span>
                                <div className="createSegmented wizardPricingSegmented" role="radiogroup" aria-label="Price unit">
                                    {PRICE_UNIT_CHOICES.map((unit) => (
                                        <button
                                            key={unit.id}
                                            type="button"
                                            className={`createSegmentedBtn wizardPricingUnitBtn createSegmentedBtn--${unit.id}${priceUnit === unit.id ? " is-active" : ""}`}
                                            aria-pressed={priceUnit === unit.id}
                                            onClick={() => setPriceUnit(unit.id)}
                                        >
                                            {unit.label}
                                        </button>
                                    ))}
                                </div>
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

                    <div className="wizardPointsRow wizardPointsRow--points">
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

                    <div className="wizardFieldGrid">
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

    if (!token) {
        const next = `${location.pathname}${location.search}`;
        return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
    }

    const flowStep = activeStep as FlowStep;
    const stepMeta = STEP_META[flowStep];

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
                                            spacesLabel={`${setupCapacity || 1} ${setupCapacity === 1 ? "space" : "spaces"}`}
                                            onEditSpaces={openSpacesSheet}
                                        />
                                    ))}
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
                        <section className="wizardSplit" key={`step-${flowStep}`}>
                            <aside className={`wizardLeft wizardLeft--${stepMeta.panelTone}`}>
                                <div className="wizardLeftLogo">ParkingBuddies</div>
                                <div className="wizardLeftStep">
                                    Step {flowStep} of {STEP_COUNT}
                                </div>
                                <h2 className="wizardLeftTitle">{stepMeta.panelTitle}</h2>
                                <p className="wizardLeftCopy">{stepMeta.panelCopy}</p>
                            </aside>

                            <section className="wizardRight">
                                <div className="wizardCard">
                                    <header className="wizardCardHead">
                                        <h3 className="h2 wizardCardTitle">{stepMeta.title}</h3>
                                        <p className="wizardCardSub">{stepMeta.subtitle}</p>
                                    </header>

                                    <div className="wizardCardBody">{renderStepBody(flowStep)}</div>
                                    <footer className="wizardCardFoot">
                                        <div className="wizardActions">
                                            <button type="button" className="btn" onClick={goBack} disabled={activeStep <= 1 || saving}>
                                                Back
                                            </button>
                                            <div className="wizardActionHint">{actionHint}</div>
                                            <button
                                                type="button"
                                                className="btn btn-primary"
                                                onClick={goNext}
                                                disabled={!currentStepReady || saving}
                                            >
                                                {activeStep === 6 ? "Publish" : "Next"}
                                            </button>
                                        </div>
                                    </footer>
                                </div>
                            </section>
                        </section>
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

                {pendingSpacesChoice === "3plus" && (
                    <label>
                        <span>Custom spaces (3+)</span>
                        <input
                            className="input"
                            type="number"
                            min={3}
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
                subtitle="Review your final details and publish when ready."
                onClose={() => {
                    setConfirmSheetOpen(false);
                    setError("");
                }}
            >
                <div className="receiptCard card">
                    <div className="h3">{title || "Untitled listing"}</div>
                    <div className="receiptBody">
                        {confirmRows.map((row) => (
                            <div className="receiptRow" key={row.label}>
                                <span className="muted tiny receiptKey">{row.label}</span>
                                <strong className="receiptValue">{row.value}</strong>
                            </div>
                        ))}
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

            <WizardSheet
                open={leaveSheetOpen}
                title="Leave create listing?"
                subtitle="You have unsaved changes in this draft."
                onClose={stayOnPage}
            >
                <div className="createFieldHint">
                    {LEAVE_DRAFT_MESSAGE}
                </div>
                <div className="createSheetActions">
                    <button type="button" className="btn" onClick={stayOnPage}>
                        Stay here
                    </button>
                    <button type="button" className="btn btn-primary" onClick={leavePage}>
                        Leave page
                    </button>
                </div>
            </WizardSheet>

            {publishingOverlayOpen && (
                <div className="createSuccessOverlay" role="status" aria-live="polite">
                    <section className="createSuccessCard">
                        <Lottie animationData={successAnimation} loop={false} className="createSuccessAnimation" />
                        <div className="h3">{isEdit ? "Saving listing..." : "Publishing listing..."}</div>
                        <div className="createFieldHint">Finalizing details and opening your spot page.</div>
                    </section>
                </div>
            )}
        </div>
    );
}

