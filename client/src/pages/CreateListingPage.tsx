import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, MouseEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import Lottie from "lottie-react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import SpotsMap from "../components/SpotsMap";
import { AppMultiToggleGroup, AppRadioCards, AppSwitchField } from "../components/ui/AppChoiceControls";
import { AppButton, AppField, AppInput, AppTextarea } from "../components/ui/AppForm";
import { AppTimePicker } from "../components/ui/AppTimePicker";
import { apiDelete, apiGet, apiPatch, apiPost, readErrorMessage } from "../lib/api";
import { useAuth, useStripeConnect } from "../lib/auth";
import successAnimation from "../assets/Success.json";
import type { ParkingSpot } from "../types";
import { isTimeHHMM as isTime, toLocalDateInput } from "./pagesShared";
import {
    AvailabilityCalendarSection,
    availabilityWindowIssue,
    asString,
    createAvailabilityWindow,
    DEFAULT_AUCTION_START_PRICE,
    DEFAULT_AVAILABILITY_END,
    DEFAULT_AVAILABILITY_START,
    DEFAULT_CENTER,
    DEFAULT_POINTS_COST,
    derivePointsCostFromGbp,
    DEFAULT_SLOT_END,
    DEFAULT_SLOT_START,
    formatYmdLabel,
    hasAvailabilityOverlap,
    CREATE_FLOW_COPY,
    LISTING_FEATURE_OPTIONS,
    LISTING_MODEL_OPTIONS,
    LONDON_VIEWBOX,
    MIN_AUCTION_START_PRICE_GBP,
    MIN_POINTS_COST,
    modeLabel,
    isListingFeature,
    listingFeatureLabel,
    normalizeMode,
    normalizePriceUnit,
    normalizeWindow,
    parseCoordinates,
    PRICE_UNIT_CHOICES,
    PRICE_UNIT_HELP,
    SheetActions,
    SPACE_CHOICES,
    STEP_COUNT,
    toAvailabilityPayload,
    Tooltip,
    validateAvailabilityWindows,
    WizardSheet,
} from "./createListingSupport";
import type {
    AvailabilityWindow,
    DraftSnapshot,
    FlowStep,
    GeocodeSuggestion,
    ListingFeature,
    Mode,
    PriceUnit,
    SpaceChoice,
    WizardSheetName,
    WizardStep,
} from "./createListingSupport";

type RawAvailabilityForEdit = {
    type?: unknown;
    date_from?: unknown;
    date_to?: unknown;
    windows?: unknown[];
    features?: unknown[];
};
type OwnerContactForEdit = {
    owner_contact_email?: string | null;
    owner_contact_phone?: string | null;
    owner_contact_info?: string | null;
};

type ListingSubmitPayload = {
    title: string;
    description: string;
    mode: Mode;
    price_gbp: number;
    price_unit: PriceUnit;
    allow_points: boolean;
    points_cost: number;
    address_text: string;
    lat: number;
    lng: number;
    image_url: string | null;
    owner_contact_email: string | null;
    owner_contact_phone: string | null;
    owner_contact_info: string | null;
    availability: ReturnType<typeof toAvailabilityPayload>;
    parking_type: "private" | "public";
    capacity_total: number;
    auction_start_price_gbp?: number;
};

const MAX_IMAGE_FILE_BYTES = 2 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function buildEditSnapshot(listing: ParkingSpot, ownerContact: OwnerContactForEdit): DraftSnapshot {
    const rawAvailability = listing.availability_json;
    const av = rawAvailability && typeof rawAvailability === "object" ? (rawAvailability as RawAvailabilityForEdit) : null;
    const todayYmd = toLocalDateInput(new Date());
    const plus30 = new Date();
    plus30.setDate(plus30.getDate() + 30);
    const fallbackFrom = typeof av?.date_from === "string" ? av.date_from : todayYmd;
    const fallbackTo = typeof av?.date_to === "string" ? av.date_to : toLocalDateInput(plus30);

    let nextAvailabilityWindows: AvailabilityWindow[] = [];
    if (av?.type === "window_slots" && Array.isArray(av?.windows)) {
        nextAvailabilityWindows = av.windows
            .map((window: unknown) => normalizeWindow(window))
            .filter((window: AvailabilityWindow | null): window is AvailabilityWindow => Boolean(window));
    }

    if (!nextAvailabilityWindows.length) {
        nextAvailabilityWindows = [
            createAvailabilityWindow({
                from: fallbackFrom,
                to: fallbackTo,
                start: DEFAULT_AVAILABILITY_START,
                end: DEFAULT_AVAILABILITY_END,
            }),
        ];
    }

    return {
        mode: normalizeMode(listing.mode),
        parkingType: listing.parking_type === "public" ? "public" : "private",
        features: Array.isArray(av?.features)
            ? av.features.filter((feature): feature is ListingFeature => isListingFeature(feature))
            : [],
        title: asString(listing.title),
        description: asString(listing.description),
        ownerContactEmail: asString(ownerContact.owner_contact_email),
        ownerContactPhone: asString(ownerContact.owner_contact_phone),
        ownerContactInfo: asString(ownerContact.owner_contact_info),
        capacityTotal: String(listing.capacity_total ?? 1),
        priceUnit: normalizePriceUnit(listing.price_unit),
        price: listing.mode === "rent" ? String(listing.price_gbp ?? "") : "",
        auctionStartPrice:
            listing.auction_start_price_gbp == null
                ? DEFAULT_AUCTION_START_PRICE
                : String(listing.auction_start_price_gbp),
        allowPoints: Boolean(listing.allow_points),
        pointsCost: String(listing.points_cost ?? DEFAULT_POINTS_COST),
        availabilityWindows: nextAvailabilityWindows,
        addressText: asString(listing.address_text),
        lat: String(listing.lat ?? ""),
        lng: String(listing.lng ?? ""),
        imageUrl: asString(listing.image_url),
    };
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
    const [features, setFeatures] = useState<ListingFeature[]>([]);
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [ownerContactEmail, setOwnerContactEmail] = useState("");
    const [ownerContactPhone, setOwnerContactPhone] = useState("");
    const [ownerContactInfo, setOwnerContactInfo] = useState("");
    const [parkingType, setParkingType] = useState<"private" | "public">("private");
    const [capacityTotal, setCapacityTotal] = useState("1");

    const [priceUnit, setPriceUnit] = useState<PriceUnit>("hour");
    const [price, setPrice] = useState("5");
    const [auctionStartPrice, setAuctionStartPrice] = useState(DEFAULT_AUCTION_START_PRICE);
    const [allowMoney, setAllowMoney] = useState(false);
    const [allowPoints, setAllowPoints] = useState(false);
    const [pointsCost, setPointsCost] = useState(DEFAULT_POINTS_COST);
    const [pointsCostTouched, setPointsCostTouched] = useState(false);

    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    const [availabilityWindows, setAvailabilityWindows] = useState<AvailabilityWindow[]>([]);
    const [draftSlotStart, setDraftSlotStart] = useState(DEFAULT_SLOT_START);
    const [draftSlotEnd, setDraftSlotEnd] = useState(DEFAULT_SLOT_END);

    const [addressText, setAddressText] = useState("");
    const [addressSearchBusy, setAddressSearchBusy] = useState(false);
    const [addressSearchMessage, setAddressSearchMessage] = useState("");
    const [addressSuggestions, setAddressSuggestions] = useState<GeocodeSuggestion[]>([]);
    const [lat, setLat] = useState(String(DEFAULT_CENTER[0]));
    const [lng, setLng] = useState(String(DEFAULT_CENTER[1]));

    const [imageUrl, setImageUrl] = useState("");
    const [activeSheet, setActiveSheet] = useState<WizardSheetName | null>(null);
    const [pendingSpacesChoice, setPendingSpacesChoice] = useState<SpaceChoice>("1");
    const [pendingSpacesCustom, setPendingSpacesCustom] = useState("3");

    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState("");
    const [connectNotice, setConnectNotice] = useState("");
    const [slotSheetError, setSlotSheetError] = useState("");
    const [publishingOverlayOpen, setPublishingOverlayOpen] = useState(false);
    const [showBasicsStepValidation, setShowBasicsStepValidation] = useState(false);
    const [showPricingStepValidation, setShowPricingStepValidation] = useState(false);
    const successTimerRef = useRef<number | null>(null);
    const draftReadyRef = useRef(false);
    const {
        beginConnectOnboarding,
        connectBusy,
    } = useStripeConnect(token);

    const imageInputRef = useRef<HTMLInputElement | null>(null);
    const spacesSheetOpen = activeSheet === "spaces";
    const customSheetOpen = activeSheet === "custom";
    const confirmSheetOpen = activeSheet === "confirm";
    const deleteSheetOpen = activeSheet === "delete";
    const draftStorageKey = isEdit && editId ? `pb_listing_draft:${editId}` : "pb_listing_draft:new";

    const parsedCoords = parseCoordinates(lat, lng);
    const mapCenter = parsedCoords ?? { lat: DEFAULT_CENTER[0], lng: DEFAULT_CENTER[1] };

    const editSnapshotQuery = useQuery({
        queryKey: ["listing-edit-snapshot", editId, token],
        enabled: Boolean(isEdit && token && editId),
        queryFn: async () => {
            if (!editId || !token) return null;
            const listingRes = await apiGet<{ parking_spot: ParkingSpot }>(`/parking-spots/${editId}`, token);
            let ownerContact: OwnerContactForEdit = {};

            try {
                const contactRes = await apiGet<{ owner_contact: OwnerContactForEdit }>(
                    `/parking-spots/${editId}/owner-contact`,
                    token
                );
                ownerContact = contactRes.owner_contact ?? {};
            } catch {
                ownerContact = {};
            }

            return buildEditSnapshot(listingRes.parking_spot, ownerContact);
        },
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
        refetchOnWindowFocus: false,
    });

    function applySnapshot(snapshot: DraftSnapshot) {
        setMode(snapshot.mode);
        setParkingType(snapshot.parkingType);
        setFeatures(snapshot.features ?? []);
        setTitle(snapshot.title);
        setDescription(snapshot.description);
        setOwnerContactEmail(snapshot.ownerContactEmail);
        setOwnerContactPhone(snapshot.ownerContactPhone);
        setOwnerContactInfo(snapshot.ownerContactInfo);
        setCapacityTotal(snapshot.capacityTotal);
        setPriceUnit(snapshot.priceUnit);
        setPrice(snapshot.price);
        setAuctionStartPrice(snapshot.auctionStartPrice);
        const hasMoney =
            snapshot.mode === "rent"
                ? Number(snapshot.price) > 0
                : snapshot.mode === "auction"
                    ? Number(snapshot.auctionStartPrice) >= MIN_AUCTION_START_PRICE_GBP
                    : false;
        setAllowMoney(hasMoney);
        setAllowPoints(snapshot.allowPoints);
        setPointsCost(snapshot.pointsCost);
        if (snapshot.allowPoints) {
            const moneyValue = snapshot.mode === "auction" ? Number(snapshot.auctionStartPrice) : Number(snapshot.price);
            const recommendedPoints = hasMoney ? derivePointsCostFromGbp(moneyValue) : 0;
            setPointsCostTouched(!recommendedPoints || snapshot.pointsCost !== String(recommendedPoints));
        } else {
            setPointsCostTouched(false);
        }
        setDateFrom("");
        setDateTo("");
        setAvailabilityWindows(snapshot.availabilityWindows);
        setAddressText(snapshot.addressText);
        setLat(snapshot.lat);
        setLng(snapshot.lng);
        setImageUrl(snapshot.imageUrl);
    }

    function buildDraftSnapshot(): DraftSnapshot {
        return {
            mode,
            parkingType,
            features,
            title,
            description,
            ownerContactEmail,
            ownerContactPhone,
            ownerContactInfo,
            capacityTotal,
            priceUnit,
            price,
            auctionStartPrice,
            allowPoints,
            pointsCost,
            availabilityWindows,
            addressText,
            lat,
            lng,
            imageUrl,
        };
    }

    function clearSavedDraft() {
        try {
            window.localStorage.removeItem(draftStorageKey);
        } catch {
        }
    }

    function saveCurrentDraft() {
        try {
            const payload = JSON.stringify({
                activeStep,
                snapshot: buildDraftSnapshot(),
            });
            window.localStorage.setItem(draftStorageKey, payload);
        } catch {
            try {
                const snapshot = buildDraftSnapshot();
                window.localStorage.setItem(
                    draftStorageKey,
                    JSON.stringify({
                        activeStep,
                        snapshot: {
                            ...snapshot,
                            imageUrl: "",
                        },
                    })
                );
            } catch {
            }
        }
    }

    function restoreSavedDraft() {
        try {
            const raw = window.localStorage.getItem(draftStorageKey);
            if (!raw) return false;
            const parsed = JSON.parse(raw) as { activeStep?: number; snapshot?: DraftSnapshot };
            if (!parsed?.snapshot) return false;
            applySnapshot(parsed.snapshot);
            const nextStep = Number(parsed.activeStep);
            if (Number.isInteger(nextStep) && nextStep >= 1 && nextStep <= STEP_COUNT) {
                setActiveStep(nextStep as WizardStep);
            }
            return true;
        } catch {
            return false;
        }
    }

    function isStripePublishBlock(message: string) {
        return /complete stripe onboarding/i.test(message) || /money payments/i.test(message);
    }

    useEffect(() => {
        return () => {
            if (successTimerRef.current != null) {
                window.clearTimeout(successTimerRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (!isEdit) return;
        setError("");
    }, [isEdit]);

    useEffect(() => {
        if (draftReadyRef.current) return;
        if (!isEdit) {
            restoreSavedDraft();
            draftReadyRef.current = true;
            return;
        }
        if (editSnapshotQuery.isPending) return;
        if (!restoreSavedDraft() && editSnapshotQuery.data) {
            applySnapshot(editSnapshotQuery.data);
        }
        draftReadyRef.current = true;
    }, [draftStorageKey, editSnapshotQuery.data, editSnapshotQuery.isPending, isEdit]);

    useEffect(() => {
        if (!editSnapshotQuery.isError) return;
        setError(readErrorMessage(editSnapshotQuery.error, "Could not load listing for editing."));
    }, [editSnapshotQuery.isError, editSnapshotQuery.error]);

    useEffect(() => {
        if (!draftReadyRef.current) return;
        saveCurrentDraft();
    }, [
        activeStep,
        mode,
        features,
        title,
        description,
        ownerContactEmail,
        ownerContactPhone,
        ownerContactInfo,
        parkingType,
        capacityTotal,
        priceUnit,
        price,
        auctionStartPrice,
        allowPoints,
        pointsCost,
        availabilityWindows,
        addressText,
        lat,
        lng,
        imageUrl,
        draftStorageKey,
    ]);

    useEffect(() => {
        if (mode === "free") {
            setAllowMoney(false);
            setAllowPoints(false);
            setPrice("0");
            setPointsCostTouched(false);
            return;
        }
        if (mode === "auction") {
            setPrice("0");
            setAuctionStartPrice((prev) =>
                !prev || Number(prev) < MIN_AUCTION_START_PRICE_GBP ? DEFAULT_AUCTION_START_PRICE : prev
            );
            return;
        }
        setPrice((prev) => (!prev || Number(prev) <= 0 ? "5" : prev));
    }, [mode]);

    useEffect(() => {
        if (allowPoints && (!pointsCost || Number(pointsCost) < MIN_POINTS_COST)) {
            setPointsCost(DEFAULT_POINTS_COST);
        }
    }, [allowPoints, pointsCost]);

    useEffect(() => {
        if (!activeSheet) return;
        const onEscape = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            closeSheet();
        };
        window.addEventListener("keydown", onEscape);
        return () => window.removeEventListener("keydown", onEscape);
    }, [activeSheet]);

    function applyPickedLocation(nextLat: number, nextLng: number, nextAddress?: string) {
        setLat(nextLat.toFixed(6));
        setLng(nextLng.toFixed(6));
        if (nextAddress) setAddressText(nextAddress);
    }

    function chooseAddressSuggestion(suggestion: GeocodeSuggestion) {
        const nextLat = Number(suggestion.lat);
        const nextLng = Number(suggestion.lon);
        if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) {
            setAddressSearchMessage("Could not use that location. Please try another result.");
            return;
        }

        applyPickedLocation(nextLat, nextLng, suggestion.display_name);
        setAddressSuggestions([]);
        setAddressSearchMessage("Location selected. You can still fine-tune the pin on the map.");
    }

    async function onAddressSearchClick() {
        const query = addressText.trim();
        if (query.length < 3) {
            setAddressSuggestions([]);
            setAddressSearchMessage("Enter at least 3 characters to search.");
            return;
        }

        setAddressSearchBusy(true);
        setAddressSearchMessage("");
        setAddressSuggestions([]);

        try {
            const params = new URLSearchParams({
                format: "jsonv2",
                limit: "3",
                addressdetails: "1",
                countrycodes: "gb",
                viewbox: LONDON_VIEWBOX,
                q: query,
            });
            const lookup = await apiGet<{ suggestions: GeocodeSuggestion[] }>(
                `/parking-spots/geocode/search?${params.toString()}`,
                token || undefined
            );
            const matches = (Array.isArray(lookup.suggestions) ? lookup.suggestions : [])
                .filter((suggestion) => Number.isFinite(Number(suggestion.lat)) && Number.isFinite(Number(suggestion.lon)))
                .slice(0, 3);

            if (!matches.length) {
                setAddressSearchMessage("No close matches found. Try adding a postcode or city.");
                return;
            }

            setAddressSuggestions(matches);
            setAddressSearchMessage(`Choose the best match below, then adjust the pin on the map if needed.`);
        } catch (error: unknown) {
            setAddressSuggestions([]);
            setAddressSearchMessage(readErrorMessage(error, "Address search is unavailable right now."));
        } finally {
            setAddressSearchBusy(false);
        }
    }

    function onMapPick(nextLat: number, nextLng: number) {
        applyPickedLocation(nextLat, nextLng);
        setAddressSuggestions([]);
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
        setActiveSheet("spaces");
    }

    function openSpacesSheetFromTile(event: MouseEvent<HTMLButtonElement>) {
        event.preventDefault();
        event.stopPropagation();
        openSpacesSheet();
    }

    function applySpacesSheet() {
        const selectedSpaces =
            pendingSpacesChoice === "3plus"
                ? Math.max(4, Math.floor(Number(pendingSpacesCustom) || 4))
                : Number(pendingSpacesChoice);

        setCapacityTotal(String(selectedSpaces));
        closeSheet();
    }

    function openCustomSheet(nextFrom = dateFrom, nextTo = dateTo) {
        if (!nextFrom || !nextTo) {
            setError("Pick start and end dates first.");
            return;
        }
        setDraftSlotStart(availabilityWindows.at(-1)?.start ?? DEFAULT_SLOT_START);
        setDraftSlotEnd(availabilityWindows.at(-1)?.end ?? DEFAULT_SLOT_END);
        setSlotSheetError("");
        setActiveSheet("custom");
        setError("");
    }

    function selectAvailabilityDate(ymd: string) {
        const todayKey = toLocalDateInput(new Date());
        if (ymd < todayKey) return;
        setError("");
        if (!dateFrom || (dateFrom && dateTo)) {
            setDateFrom(ymd);
            setDateTo("");
            return;
        }
        if (ymd < dateFrom) {
            setDateFrom(ymd);
            return;
        }
        setDateTo(ymd);
        openCustomSheet(dateFrom, ymd);
    }

    function resetAvailabilitySelection() {
        setDateFrom("");
        setDateTo("");
        setSlotSheetError("");
        setError("");
    }

    function removeAvailabilityWindow(windowId: string) {
        setAvailabilityWindows((prev) => prev.filter((window) => window.id !== windowId));
    }

    function addAvailabilityWindow() {
        if (!dateFrom || !dateTo) {
            setSlotSheetError("Pick start and end dates first.");
            return;
        }
        if (!isTime(draftSlotStart) || !isTime(draftSlotEnd)) {
            setSlotSheetError("Choose valid start and end times.");
            return;
        }
        const nextWindow = createAvailabilityWindow({
            from: dateFrom,
            to: dateTo,
            start: draftSlotStart,
            end: draftSlotEnd,
        });
        const issue = availabilityWindowIssue(nextWindow);
        if (issue) {
            setSlotSheetError(issue === "Each slot needs end time after start time." ? "Choose a valid start and end time." : issue);
            return;
        }

        if (hasAvailabilityOverlap(availabilityWindows, nextWindow)) {
            setSlotSheetError("This slot overlaps an existing slot. Change the date or time.");
            return;
        }

        setAvailabilityWindows((prev) => [...prev, nextWindow]);
        setDateFrom("");
        setDateTo("");
        setSlotSheetError("");
        closeSheet();
        setError("");
    }

    function openImagePicker() {
        imageInputRef.current?.click();
    }

    function closeSheet() {
        setActiveSheet(null);
        setSlotSheetError("");
    }

    function openDeleteSheet() {
        if (!isEdit || !editId) return;
        setError("");
        setActiveSheet("delete");
    }

    function onImageFileChange(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        if (!file) return;
        if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
            setError("Please choose a JPG, PNG, or WEBP image.");
            event.target.value = "";
            return;
        }
        if (file.size > MAX_IMAGE_FILE_BYTES) {
            setError("Image must be 2MB or smaller.");
            event.target.value = "";
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            const result = typeof reader.result === "string" ? reader.result : "";
            if (!result) {
                setError("Could not read that image file.");
                return;
            }
            if (result.length > 4_500_000) {
                setError("Image is too large after encoding. Please use a smaller file.");
                event.target.value = "";
                return;
            }
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

    const normalizedTitle = title.trim();
    const normalizedDescription = description.trim();
    const normalizedOwnerContactEmail = ownerContactEmail.trim();
    const normalizedOwnerContactPhone = ownerContactPhone.trim();
    const normalizedOwnerContactInfo = ownerContactInfo.trim();
    const normalizedAddress = addressText.trim();
    const setupCapacity = Math.max(0, Math.floor(Number(capacityTotal) || 0));
    const spacesLabel = `${setupCapacity || 1} ${(setupCapacity || 1) === 1 ? "space" : "spaces"}`;
    const priceNum = Number(price || 0);
    const pointsNum = Number(pointsCost || 0);
    const auctionStartNum = Number(auctionStartPrice || 0);
    const recommendedPointsNum =
        allowPoints && allowMoney
            ? derivePointsCostFromGbp(mode === "auction" ? auctionStartNum : priceNum)
            : 0;
    const effectivePointsNum = allowPoints ? pointsNum : 0;
    const derivedPointsNum = pointsCostTouched && effectivePointsNum > 0 ? effectivePointsNum : recommendedPointsNum;

    useEffect(() => {
        if (!allowPoints || !allowMoney || recommendedPointsNum <= 0) return;
        if (pointsCostTouched && Number(pointsCost) >= MIN_POINTS_COST) return;
        const nextValue = String(recommendedPointsNum);
        if (pointsCost !== nextValue) setPointsCost(nextValue);
    }, [allowMoney, allowPoints, pointsCost, pointsCostTouched, recommendedPointsNum]);

    const capacityIssue = setupCapacity < 1 ? "Spaces must be at least 1." : "";
    const titleIssue = normalizedTitle.length < 3 ? "Add a listing name with at least 3 characters." : "";
    const descriptionIssue =
        normalizedDescription.length > 0 && normalizedDescription.length < 5
            ? "Description should be at least 5 characters, or leave it empty."
            : "";
    const paymentMethodIssue = mode !== "free" && !allowMoney && !allowPoints ? "Enable at least one payment method." : "";
    const pricingValueIssue =
        allowMoney && mode === "rent" && (!Number.isFinite(priceNum) || priceNum <= 0)
            ? "Rent listings need a valid price above 0."
            : allowMoney && mode === "auction" && (!Number.isFinite(auctionStartNum) || auctionStartNum < MIN_AUCTION_START_PRICE_GBP)
                    ? "Auction start price must be at least GBP 0.10."
                    : allowPoints && (!Number.isFinite(pointsNum) || pointsNum < MIN_POINTS_COST)
                        ? "Points must be at least 1."
                        : "";
    const pricingIssue = paymentMethodIssue || pricingValueIssue;
    const visiblePricingIssue = paymentMethodIssue && !showPricingStepValidation ? "" : pricingIssue;

    const availabilityPayloadResult = useMemo<{ payload: ReturnType<typeof toAvailabilityPayload> | null; issue: string }>(() => {
        const issue = validateAvailabilityWindows(availabilityWindows);
        if (issue) return { payload: null, issue };
        return { payload: toAvailabilityPayload(availabilityWindows, features), issue: "" };
    }, [availabilityWindows, features]);
    const availabilityIssue = availabilityPayloadResult.issue;

    const locationIssue = !parsedCoords
        ? "Set a map pin so drivers can find your listing."
        : normalizedAddress.length < 5
            ? "Add an address with at least 5 characters."
            : "";

    const submitIssue = capacityIssue || titleIssue || descriptionIssue || pricingIssue || availabilityIssue || locationIssue;
    const stepIssueByStep: Record<WizardStep, string> = {
        1: capacityIssue,
        2: titleIssue || descriptionIssue,
        3: pricingIssue,
        4: availabilityIssue,
        5: locationIssue,
        6: submitIssue,
    };
    const stepReady: Record<WizardStep, boolean> = {
        1: !stepIssueByStep[1],
        2: !stepIssueByStep[2],
        3: !stepIssueByStep[3],
        4: !stepIssueByStep[4],
        5: !stepIssueByStep[5],
        6: !stepIssueByStep[6],
    };
    const publishReady = stepReady[6];

    const submitPayload: ListingSubmitPayload | null =
        !submitIssue && parsedCoords && availabilityPayloadResult.payload
            ? {
                  title: normalizedTitle,
                  description: normalizedDescription || "No description provided.",
                  mode,
                  price_gbp: mode === "rent" && allowMoney ? priceNum : 0,
                  price_unit: priceUnit,
                  allow_points: mode === "free" ? false : allowPoints,
                  points_cost: mode === "free" ? 0 : effectivePointsNum,
                  address_text: normalizedAddress,
                  lat: parsedCoords.lat,
                  lng: parsedCoords.lng,
                  image_url: imageUrl.trim() || null,
                  owner_contact_email: normalizedOwnerContactEmail || null,
                  owner_contact_phone: normalizedOwnerContactPhone || null,
                  owner_contact_info: normalizedOwnerContactInfo || null,
                  availability: availabilityPayloadResult.payload,
                  parking_type: parkingType,
                  capacity_total: setupCapacity,
                  ...(mode === "auction" ? { auction_start_price_gbp: allowMoney ? auctionStartNum : 0 } : {}),
              }
            : null;

    async function submitListing() {
        if (!token) {
            setError("Please sign in to continue.");
            return;
        }

        setError("");
        setConnectNotice("");
        if (!submitPayload) {
            setError(submitIssue || "Please review your listing details.");
            return;
        }

        setSaving(true);
        try {
            const response =
                isEdit && editId
                    ? await apiPatch<{ parking_spot: ParkingSpot }>(`/parking-spots/${editId}`, submitPayload, token)
                    : await apiPost<{ parking_spot: ParkingSpot }>("/parking-spots", submitPayload, token);
            const nextId = response.parking_spot?.id || editId;
            clearSavedDraft();
            closeSheet();
            showPublishSuccess(nextId ? `/spots/${nextId}` : "/dashboard");
        } catch (error: unknown) {
            const message = readErrorMessage(error, isEdit ? "Failed to save listing." : "Failed to publish listing.");
            if (isStripePublishBlock(message)) {
                saveCurrentDraft();
                setConnectNotice(
                    "Please complete Stripe’s official onboarding before publishing a money listing. It usually takes around 5 minutes. Your draft is saved and will be waiting when you come back, or you can switch this listing to points only."
                );
                return;
            }
            setError(message);
        } finally {
            setSaving(false);
        }
    }

    async function handleConnectStripeFromPublish() {
        saveCurrentDraft();
        setError("");
        const result = await beginConnectOnboarding("stripe");
        if (!result.ok && result.error) {
            setError(result.error);
        }
    }

    async function deleteListing() {
        if (!token || !editId) {
            setError("This listing cannot be deleted right now.");
            return;
        }

        setError("");
        setDeleting(true);
        try {
            await apiDelete(`/parking-spots/${editId}`, token);
            closeSheet();
            navigate("/dashboard?tab=manageListings", { replace: true });
        } catch (error: unknown) {
            setError(readErrorMessage(error, "Failed to delete listing."));
        } finally {
            setDeleting(false);
        }
    }

    const stepHint = stepIssueByStep[activeStep];

    const currentStepReady = stepReady[activeStep];
    const showFooterStepHint = activeStep === 1 || activeStep === 6;

    const priceSummary =
        mode === "free"
            ? "Free listing"
            : allowMoney
                ? mode === "rent"
                    ? `GBP ${Number(price || 0).toFixed(2)} / ${priceUnit}${allowPoints && derivedPointsNum > 0 ? ` | ${derivedPointsNum} pts / ${priceUnit}` : ""}`
                    : `Bid from GBP ${Number(auctionStartPrice || 0).toFixed(2)} / ${priceUnit}${allowPoints && derivedPointsNum > 0 ? ` | ${derivedPointsNum} pts / ${priceUnit}` : ""}`
                : allowPoints
                    ? `${effectivePointsNum} pts / ${priceUnit}`
                    : "No payment method";
    const availabilitySummary = availabilityWindows.length
        ? `${availabilityWindows.length} slot${availabilityWindows.length === 1 ? "" : "s"} configured`
        : "No availability set";
    const featuresSummary = features.length
        ? features.map((feature) => listingFeatureLabel(feature)).join(", ")
        : "None selected";
    const confirmRows: Array<{ label: string; value: string }> = [
        { label: "Model", value: modeLabel(mode) },
        { label: "Features", value: featuresSummary },
        { label: "Spaces", value: `${setupCapacity || 1} ${setupCapacity === 1 ? "space" : "spaces"}` },
        { label: "Pricing", value: priceSummary },
        { label: "Availability", value: availabilitySummary },
        { label: "Address", value: addressText.trim() || "Address not set" },
    ];
    const draftStartLabel = dateFrom ? formatYmdLabel(dateFrom) : "selected start date";
    const draftEndLabel = dateTo ? formatYmdLabel(dateTo) : "selected end date";

    function goNext() {
        if (!currentStepReady) {
            if (activeStep === 2) setShowBasicsStepValidation(true);
            if (activeStep === 3) setShowPricingStepValidation(true);
            return;
        }
        if (activeStep === 6) {
            setError("");
            setActiveSheet("confirm");
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
        switch (step) {
            case 2:
            return (
                <div className="stack">
                    <AppField label="Title*">
                        <AppInput
                            value={title}
                            onChange={(event) => setTitle(event.target.value)}
                            placeholder="Example: Secure driveway near station"
                        />
                        {showBasicsStepValidation && titleIssue && <div className="createInlineError">{titleIssue}</div>}
                    </AppField>

                    <AppField label="Description">
                        <AppTextarea
                            rows={5}
                            value={description}
                            onChange={(event) => setDescription(event.target.value)}
                            placeholder="Access notes, gate details, size limits, and nearby landmarks."
                        />
                        {descriptionIssue && description.length > 0 && (
                            <div className="createInlineError">Use at least 5 characters.</div>
                        )}
                    </AppField>

                    <div className="wizardLabelRow wizardLabelRow--small">
                        <span className="wizardPricingHead">Space features</span>
                    </div>
                    <AppMultiToggleGroup
                        ariaLabel="Space features"
                        className="wizardFeatureGrid"
                        itemClassName="wizardFeatureChip"
                        values={features}
                        onChange={setFeatures}
                        options={LISTING_FEATURE_OPTIONS.map((feature) => ({
                            id: feature.id,
                            className: `wizardFeatureChip--${feature.tone}`,
                            content: <span className="wizardFeatureChipLabel">{feature.label}</span>,
                        }))}
                    />

                    <div className="wizardContactBlock">
                        <div className="createFieldHint">
                            The details below will only be shared with drivers after booking is complete.
                        </div>

                        <AppField label="Email">
                            <AppInput
                                type="email"
                                value={ownerContactEmail}
                                onChange={(event) => setOwnerContactEmail(event.target.value)}
                                placeholder="owner@email.com"
                            />
                        </AppField>

                        <AppField label="Phone">
                            <AppInput
                                value={ownerContactPhone}
                                onChange={(event) => setOwnerContactPhone(event.target.value)}
                                placeholder="07123 456789"
                            />
                        </AppField>

                        <AppField label="Additional instructions and information">
                            <AppTextarea
                                rows={3}
                                value={ownerContactInfo}
                                onChange={(event) => setOwnerContactInfo(event.target.value)}
                                placeholder="Gate code, where to park, or arrival notes."
                            />
                        </AppField>
                    </div>
                </div>
            );
            case 3:
            return (
                <div className="wizardSection wizardSection--pricing">
                    <div className="wizardLabelRow">
                        <div className="wizardSubTitle">Pricing setup</div>
                        <Tooltip
                            label="Pricing help"
                            text="Hourly works best for shorter flexible stays. Daily charges one full day for each booked day, even if the driver stays for only part of it. Weekly is best for longer stays and charges by full weeks."
                        />
                    </div>

                    {mode !== "free" && (
                        <div className="wizardPricingBlock">
                            <div className="wizardLabelRow wizardLabelRow--small">
                                <span className="wizardPricingHead">Charging method</span>
                            </div>
                            <AppRadioCards
                                ariaLabel="Price unit"
                                className="wizardOptionGrid"
                                itemClassName="wizardOptionCard"
                                orientation="horizontal"
                                value={priceUnit}
                                onChange={setPriceUnit}
                                options={PRICE_UNIT_CHOICES.map((unit) => ({
                                    id: unit.id,
                                    content: <span className="wizardOptionTitle">{unit.label}</span>,
                                }))}
                            />
                            <div className="wizardInlineText">
                                {PRICE_UNIT_HELP[priceUnit]}
                            </div>
                            <div className="createFieldHint">
                                Hourly is usually best for short visits, daily works best for day-long parking, and weekly suits longer stays.
                            </div>
                        </div>
                    )}

                    <div className="wizardPointsRow wizardPointsRow--points">
                        <AppSwitchField
                            label="Allow points payment"
                            isSelected={allowPoints}
                            onChange={(next) => {
                                setAllowPoints(next);
                                if (!next) {
                                    setPointsCostTouched(false);
                                    return;
                                }
                                if (!allowMoney || recommendedPointsNum <= 0 || pointsCostTouched) return;
                                setPointsCost(String(recommendedPointsNum));
                            }}
                            isDisabled={mode === "free"}
                        />

                        {allowPoints && mode !== "free" && (
                            <AppField
                                className="wizardPointsInput"
                                label={`Points per ${priceUnit}`}
                                description={
                                    allowMoney
                                        ? recommendedPointsNum > 0
                                            ? `The recommended price is ${recommendedPointsNum} points. You can change this if you want.`
                                            : "Add a money price first to see the recommended points rate."
                                        : "Set a custom points rate for this listing."
                                }
                            >
                                <AppInput
                                    type="number"
                                    min="1"
                                    step="1"
                                    value={pointsCost}
                                    onChange={(event) => {
                                        setPointsCost(event.target.value);
                                        setPointsCostTouched(true);
                                    }}
                                />
                            </AppField>
                        )}
                    </div>

                    {mode !== "free" && (
                        <div className="wizardPointsRow wizardPointsRow--money">
                            <AppSwitchField
                                label="Allow money payment"
                                isSelected={allowMoney}
                                onChange={setAllowMoney}
                            />
                            {allowMoney && (
                                <AppField
                                    className="wizardPointsInput"
                                    label={mode === "auction" ? `Starting bid per ${priceUnit} (\u00A3)` : `Price per ${priceUnit} (\u00A3)`}
                                >
                                    <AppInput
                                        type="number"
                                        min={mode === "auction" ? "0.1" : "0"}
                                        step={mode === "auction" ? "0.1" : "0.5"}
                                        value={mode === "auction" ? auctionStartPrice : price}
                                        onChange={(event) => {
                                            if (mode === "auction") {
                                                setAuctionStartPrice(event.target.value);
                                                return;
                                            }
                                            setPrice(event.target.value);
                                        }}
                                    />
                                </AppField>
                            )}
                        </div>
                    )}

                    {mode === "free" && <div className="wizardInlineText">Free listing selected, so no money price is required.</div>}

                    {visiblePricingIssue && <div className="createInlineError">{visiblePricingIssue}</div>}
                </div>
            );
            case 4:
            return (
                <AvailabilityCalendarSection
                    dateFrom={dateFrom}
                    dateTo={dateTo}
                    windows={availabilityWindows}
                    issue={availabilityIssue}
                    onSelectDate={selectAvailabilityDate}
                    onResetSelection={resetAvailabilitySelection}
                    onRemoveWindow={removeAvailabilityWindow}
                />
            );
            case 5:
            return (
                <>
                    <div className="addressLookupWrap">
                        <AppField
                            label="Address"
                            description="Search to set a pin, then click map to adjust precisely."
                        >
                            <div className="addressInputRow">
                                <AppInput
                                    value={addressText}
                                    onChange={(event) => {
                                        setAddressText(event.target.value);
                                        setLat("");
                                        setLng("");
                                        setAddressSuggestions([]);
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
                                <AppButton
                                    type="button"
                                    variant="primary"
                                    className="addressSearchBtn"
                                    disabled={addressSearchBusy}
                                    onClick={() => void onAddressSearchClick()}
                                >
                                    {addressSearchBusy ? "Searching..." : "Search"}
                                </AppButton>
                            </div>
                        </AppField>

                        {addressSearchMessage && <div className="addressLookupStatus">{addressSearchMessage}</div>}

                        {addressSuggestions.length > 0 && (
                            <div className="addressSuggestionList" role="list" aria-label="Address suggestions">
                                {addressSuggestions.map((suggestion, index) => (
                                    <button
                                        key={`${suggestion.lat}-${suggestion.lon}-${index}`}
                                        type="button"
                                        className="addressSuggestionItem"
                                        onClick={() => chooseAddressSuggestion(suggestion)}
                                    >
                                        <span className="addressSuggestionRank">{index + 1}</span>
                                        <span className="addressSuggestionCopy">
                                            <strong>{index === 0 ? "Closest match" : `Option ${index + 1}`}</strong>
                                            <span>{suggestion.display_name}</span>
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="mapWrap mapWrap--pin wizardMap">
                        <SpotsMap
                            spots={[]}
                            center={mapCenter}
                            pickerPosition={parsedCoords}
                            onMapPick={onMapPick}
                        />
                    </div>

                    {locationIssue && (
                        <div className="createInlineError">Add a valid address and map pin before publishing.</div>
                    )}
                </>
            );
            case 6:
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
                        <AppButton type="button" variant="primary" onClick={openImagePicker}>
                            {imageUrl.trim() ? "Change image" : "Choose image"}
                        </AppButton>
                        {imageUrl.trim() && (
                            <AppButton type="button" onClick={clearImage}>
                                Remove image
                            </AppButton>
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
            default:
                return null;
        }
    }

    const actionHint = error || (!currentStepReady && showFooterStepHint && stepHint ? stepHint : "");

    if (!token) {
        const next = `${location.pathname}${location.search}`;
        return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
    }

    const flowStep = activeStep as FlowStep;
    const stepMeta = CREATE_FLOW_COPY[flowStep];

    return (
        <div className="container createWizardPage">
            {isEdit && editSnapshotQuery.isPending ? (
                null
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

                                <AppRadioCards
                                    ariaLabel="Listing model"
                                    className="wizardTileGrid"
                                    itemClassName="wizardTile"
                                    orientation="horizontal"
                                    value={mode}
                                    onChange={setMode}
                                    options={LISTING_MODEL_OPTIONS.map((choice) => ({
                                        id: choice.mode,
                                        className: `wizardTile--${choice.tone}`,
                                        content: (
                                            <>
                                                <div className="wizardTileHead">
                                                    <span className="wizardTileTitle">{choice.title}</span>
                                                    <Tooltip label={`${choice.title} mode help`} text={choice.help} />
                                                </div>
                                                <span className="wizardTileCopy">{choice.copy}</span>
                                                {mode === choice.mode && (
                                                    <div className="wizardTileFooter">
                                                        <button
                                                            type="button"
                                                            className="btn wizardTileSpotsBtn"
                                                            onClick={openSpacesSheetFromTile}
                                                        >
                                                            Edit spaces
                                                        </button>
                                                        <span className="wizardTileSpacesValue">{spacesLabel}</span>
                                                    </div>
                                                )}
                                            </>
                                        ),
                                    }))}
                                />

                                <div className="wizardActions wizardActions--intro">
                                    {isEdit && (
                                        <AppButton
                                            type="button"
                                            variant="ghost"
                                            onPress={openDeleteSheet}
                                            disabled={saving || deleting}
                                        >
                                            Delete listing
                                        </AppButton>
                                    )}
                                    <Link className="btn" to={isEdit && editId ? `/spots/${editId}` : "/dashboard"}>
                                        Cancel
                                    </Link>
                                    <AppButton
                                        type="button"
                                        variant="primary"
                                        onClick={goNext}
                                        disabled={!stepReady[1] || saving}
                                    >
                                        Next
                                    </AppButton>
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
                                            <div className="wizardActionsLead">
                                                <AppButton type="button" onClick={goBack} disabled={activeStep <= 1 || saving || deleting}>
                                                    Back
                                                </AppButton>
                                            </div>
                                            <div className="wizardActionHint">{actionHint}</div>
                                            <AppButton
                                                type="button"
                                                variant="primary"
                                                onClick={goNext}
                                                disabled={(activeStep !== 2 && activeStep !== 3 && !currentStepReady) || saving || deleting}
                                            >
                                                {activeStep === 6 ? "Publish" : "Next"}
                                            </AppButton>
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
                onClose={closeSheet}
            >
                <AppRadioCards
                    ariaLabel="Choose spaces"
                    className="createSheetSpaceGrid"
                    itemClassName="createSheetSpaceBtn"
                    orientation="horizontal"
                    value={pendingSpacesChoice}
                    onChange={(next) => setPendingSpacesChoice(next)}
                    options={SPACE_CHOICES.map((choice) => ({
                        id: choice.id,
                        content: choice.label,
                    }))}
                />

                {pendingSpacesChoice === "3plus" && (
                    <AppField label="Custom spaces (3+)">
                        <AppInput
                            type="number"
                            min={3}
                            step={1}
                            value={pendingSpacesCustom}
                            onChange={(event) => setPendingSpacesCustom(event.target.value)}
                        />
                    </AppField>
                )}

                <SheetActions
                    secondaryLabel="Cancel"
                    onSecondary={closeSheet}
                    primaryLabel="Apply spaces"
                    onPrimary={applySpacesSheet}
                />
            </WizardSheet>

            <WizardSheet
                open={customSheetOpen}
                title="Add slot"
                subtitle="Set times for this date range."
                onClose={closeSheet}
            >
                <div className="slotSheet">
                    <div className="slotSheetSummary">
                        <div className="slotSheetSummaryLabel">Selected range</div>
                        <div className="slotSheetSummaryValue">
                            {draftStartLabel} {" -> "} {draftEndLabel}
                        </div>
                    </div>

                    <div className="slotSheetFields">
                        <AppField className="slotSheetField" label="Start time" description={<div className="slotSheetFieldNote">{draftStartLabel}</div>}>
                            <AppTimePicker
                                value={draftSlotStart}
                                onChange={setDraftSlotStart}
                            />
                        </AppField>
                        <AppField className="slotSheetField" label="End time" description={<div className="slotSheetFieldNote">{draftEndLabel}</div>}>
                            <AppTimePicker
                                value={draftSlotEnd}
                                onChange={setDraftSlotEnd}
                            />
                        </AppField>
                    </div>
                    {slotSheetError && <div className="createInlineError">{slotSheetError}</div>}
                </div>

                <SheetActions
                    secondaryLabel="Cancel"
                    onSecondary={closeSheet}
                    primaryLabel="Add slot"
                    onPrimary={addAvailabilityWindow}
                />
            </WizardSheet>

            <WizardSheet
                open={confirmSheetOpen}
                title={isEdit ? "Confirm save" : "Confirm publish"}
                subtitle="Review your final details and publish when ready."
                onClose={() => {
                    closeSheet();
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

                {connectNotice && (
                    <div className="createConnectNotice">
                        <div className="h3">Stripe onboarding needed</div>
                        <div className="createFieldHint">{connectNotice}</div>
                        <div className="createConnectNoticeActions">
                            <AppButton
                                type="button"
                                variant="primary"
                                onPress={() => void handleConnectStripeFromPublish()}
                                disabled={connectBusy}
                            >
                                {connectBusy ? "Opening..." : "Complete Stripe onboarding"}
                            </AppButton>
                            <AppButton
                                type="button"
                                onPress={() => {
                                    setConnectNotice("");
                                    closeSheet();
                                    setActiveStep(3);
                                }}
                            >
                                Go back to pricing
                            </AppButton>
                        </div>
                    </div>
                )}

                {error && <div className="createInlineError">{error}</div>}

                <SheetActions
                    secondaryLabel="Back"
                    onSecondary={() => {
                        closeSheet();
                        setError("");
                    }}
                    secondaryDisabled={saving}
                    primaryLabel={saving ? "Saving..." : isEdit ? "Save listing" : "Publish listing"}
                    onPrimary={() => void submitListing()}
                    primaryDisabled={!publishReady || saving}
                />
            </WizardSheet>

            <WizardSheet
                open={deleteSheetOpen}
                title="Delete listing"
                subtitle="This removes the listing from search and stops any new bookings or bids."
                onClose={() => {
                    closeSheet();
                    setError("");
                }}
            >
                <div className="slotSheet">
                    <div className="slotSheetSummary">
                        <div className="slotSheetSummaryLabel">Listing</div>
                        <div className="slotSheetSummaryValue">{title.trim() || "Untitled listing"}</div>
                    </div>
                    <div className="createFieldHint">
                        Existing booking and bidding history is kept for records, but the listing will no longer be active.
                    </div>
                    {error && <div className="createInlineError">{error}</div>}
                </div>

                <div className="createSheetActions">
                    <AppButton
                        type="button"
                        onPress={() => {
                            closeSheet();
                            setError("");
                        }}
                        disabled={deleting}
                    >
                        Keep listing
                    </AppButton>
                    <AppButton
                        type="button"
                        variant="ghost"
                        onPress={() => void deleteListing()}
                        disabled={deleting}
                    >
                        {deleting ? "Deleting..." : "Delete listing"}
                    </AppButton>
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
