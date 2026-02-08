import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import L from "leaflet";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiDelete, apiGet, apiPatch, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { ParkingSpot } from "../types";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

type Mode = "free" | "rent" | "auction";
type PriceUnit = "hour" | "day" | "week";
type ParkingType = "private" | "public";
type AvailabilityType = "24_7" | "same_everyday" | "custom_weekly";
type FormSectionKey = "intro" | "type" | "availability" | "pricing" | "location";
type GeocodeSuggestion = {
    place_id: number;
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

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DEFAULT_CENTER: [number, number] = [51.5074, -0.1278];
const LONDON_VIEWBOX = "-0.5103,51.6919,0.3340,51.2868";
const MIN_AUCTION_START_PRICE_GBP = 0.1;
const MIN_POINTS_COST = 1;
const DEFAULT_AUCTION_START_PRICE = String(MIN_AUCTION_START_PRICE_GBP);
const DEFAULT_POINTS_COST = String(MIN_POINTS_COST);

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: markerIcon2x,
    iconUrl: markerIcon,
    shadowUrl: markerShadow,
});

const defaultIcon = new L.Icon.Default();

function toLocalDateTimeInput(iso: string | null | undefined) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
}

function toIsoFromLocalInput(local: string) {
    const d = new Date(local);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
}

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

function toLocalDateTimeValue(date: Date) {
    return `${toLocalDateInput(date)}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function dateFromToday(daysAhead: number) {
    const next = new Date();
    next.setHours(0, 0, 0, 0);
    next.setDate(next.getDate() + daysAhead);
    return toLocalDateInput(next);
}

function dateTimeMonthsFromNow(monthsAhead: number) {
    const next = new Date();
    next.setMonth(next.getMonth() + monthsAhead);
    return toLocalDateTimeValue(next);
}

function toTitleCaseWords(value: string) {
    return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

function modeDisplayLabel(value: Mode) {
    if (value === "rent") return "Rent";
    if (value === "auction") return "Auction";
    return "Free";
}

function parkingTypeDisplayLabel(value: ParkingType) {
    return value === "private" ? "Private" : "Public";
}

function createAvailabilitySlot(partial?: Partial<Omit<AvailabilitySlot, "id">>): AvailabilitySlot {
    return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        dow: partial?.dow ?? 1,
        start: partial?.start ?? "09:00",
        end: partial?.end ?? "17:00",
    };
}

function MapRecenter({ center }: { center: [number, number] }) {
    const map = useMap();
    useEffect(() => {
        const zoom = map.getZoom();
        map.setView(center, zoom, { animate: true });
    }, [center[0], center[1], map]);
    return null;
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

export default function CreateListingPage() {
    const { token, user } = useAuth();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();

    const editId = searchParams.get("edit");
    const isEdit = Boolean(editId);

    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [mode, setMode] = useState<Mode>("rent");
    const [price, setPrice] = useState("5");
    const [priceUnit, setPriceUnit] = useState<PriceUnit>("hour");
    const [allowPoints, setAllowPoints] = useState(false);
    const [pointsCost, setPointsCost] = useState(DEFAULT_POINTS_COST);
    const [addressText, setAddressText] = useState("");
    const [addressSuggestions, setAddressSuggestions] = useState<GeocodeSuggestion[]>([]);
    const [addressSearchBusy, setAddressSearchBusy] = useState(false);
    const [addressSearchMessage, setAddressSearchMessage] = useState("");
    const [addressDropdownOpen, setAddressDropdownOpen] = useState(false);
    const [reverseLookupBusy, setReverseLookupBusy] = useState(false);
    const [lat, setLat] = useState(String(DEFAULT_CENTER[0]));
    const [lng, setLng] = useState(String(DEFAULT_CENTER[1]));
    const [imageUrl, setImageUrl] = useState("");
    const [selectedImageName, setSelectedImageName] = useState("");
    const [parkingType, setParkingType] = useState<ParkingType>("private");
    const [capacityTotal, setCapacityTotal] = useState("1");
    const [capacityAvailable, setCapacityAvailable] = useState("1");
    const [showSetupModal, setShowSetupModal] = useState(false);
    const [setupTypeDraft, setSetupTypeDraft] = useState<ParkingType>("private");
    const [setupSpacesDraft, setSetupSpacesDraft] = useState("1");

    const [availabilityType, setAvailabilityType] = useState<AvailabilityType>("24_7");
    const [dateFrom, setDateFrom] = useState(() => dateFromToday(0));
    const [dateTo, setDateTo] = useState(() => dateFromToday(3));
    const [sameStart, setSameStart] = useState("09:00");
    const [sameEnd, setSameEnd] = useState("17:00");
    const [customWeeklySlots, setCustomWeeklySlots] = useState<AvailabilitySlot[]>([createAvailabilitySlot()]);

    const [auctionStartPrice, setAuctionStartPrice] = useState(DEFAULT_AUCTION_START_PRICE);
    const [auctionEndLocal, setAuctionEndLocal] = useState(() => dateTimeMonthsFromNow(1));

    const [loadingExisting, setLoadingExisting] = useState(false);
    const [saving, setSaving] = useState(false);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [pendingPayload, setPendingPayload] = useState<Record<string, any> | null>(null);
    const [confirmingPublish, setConfirmingPublish] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const introSectionRef = useRef<HTMLDivElement | null>(null);
    const typeSectionRef = useRef<HTMLDivElement | null>(null);
    const availabilitySectionRef = useRef<HTMLDivElement | null>(null);
    const pricingSectionRef = useRef<HTMLDivElement | null>(null);
    const locationSectionRef = useRef<HTMLDivElement | null>(null);
    const imageInputRef = useRef<HTMLInputElement | null>(null);
    const addressLookupRef = useRef<HTMLDivElement | null>(null);
    const addressSearchAbortRef = useRef<AbortController | null>(null);
    const reverseLookupAbortRef = useRef<AbortController | null>(null);
    const suppressSuggestRef = useRef(false);

    const parsedCoords = useMemo(() => parseCoordinates(lat, lng), [lat, lng]);
    const mapCenter: [number, number] = parsedCoords ? [parsedCoords.lat, parsedCoords.lng] : DEFAULT_CENTER;
    const markerPosition: [number, number] | null = parsedCoords ? [parsedCoords.lat, parsedCoords.lng] : null;

    useEffect(() => {
        if (!showDeleteModal && !showSetupModal && !showConfirmModal) return;
        const onEsc = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            if (showDeleteModal && !deleting) {
                setShowDeleteModal(false);
            } else if (showSetupModal) {
                setShowSetupModal(false);
            } else if (showConfirmModal && !confirmingPublish) {
                setShowConfirmModal(false);
                setPendingPayload(null);
            }
        };
        window.addEventListener("keydown", onEsc);
        return () => window.removeEventListener("keydown", onEsc);
    }, [showDeleteModal, deleting, showSetupModal, showConfirmModal, confirmingPublish]);

    useEffect(() => {
        if (!isEdit || !token || !editId) return;
        let active = true;
        setLoadingExisting(true);
        setError("");

        apiGet<{ parking_spot: ParkingSpot }>(`/parking-spots/${editId}`, token)
            .then((res) => {
                if (!active) return;
                const s = res.parking_spot;
                const av = (s.availability_json ?? null) as any;

                setTitle(s.title ?? "");
                setDescription(s.description ?? "");
                setMode((s.mode as Mode) ?? "rent");
                setPrice(s.mode === "rent" ? String(s.price_gbp ?? "") : "");
                setPriceUnit((s.price_unit as PriceUnit) ?? "hour");
                setAllowPoints(Boolean(s.allow_points));
                setPointsCost(String(s.points_cost ?? ""));
                suppressSuggestRef.current = true;
                setAddressText(s.address_text ?? "");
                setLat(String(s.lat ?? ""));
                setLng(String(s.lng ?? ""));
                setImageUrl(s.image_url ?? "");
                setSelectedImageName(s.image_url ? "Current listing image" : "");
                const nextParkingType = (s.parking_type as ParkingType) ?? "private";
                const nextCapacity = String(s.capacity_total ?? 1);
                setParkingType(nextParkingType);
                setCapacityTotal(nextCapacity);
                setCapacityAvailable(String(s.capacity_available ?? s.capacity_total ?? 1));
                setSetupTypeDraft(nextParkingType);
                setSetupSpacesDraft(nextCapacity);

                setDateFrom(typeof av?.date_from === "string" ? av.date_from : dateFromToday(0));
                setDateTo(typeof av?.date_to === "string" ? av.date_to : dateFromToday(3));
                if (av?.type === "same_everyday") {
                    setAvailabilityType("same_everyday");
                    setSameStart(typeof av?.start === "string" ? av.start : "09:00");
                    setSameEnd(typeof av?.end === "string" ? av.end : "17:00");
                } else if (av?.type === "custom_weekly" && Array.isArray(av?.rules)) {
                    setAvailabilityType("custom_weekly");
                    const nextSlots = av.rules
                        .map((r: any) => ({
                            dow: Number(r?.dow),
                            start: typeof r?.start === "string" ? r.start : "",
                            end: typeof r?.end === "string" ? r.end : "",
                        }))
                        .filter((r: any) => Number.isInteger(r.dow) && r.dow >= 0 && r.dow <= 6 && isTime(r.start) && isTime(r.end))
                        .map((r: any) => createAvailabilitySlot({ dow: r.dow, start: r.start, end: r.end }));
                    setCustomWeeklySlots(nextSlots.length > 0 ? nextSlots : [createAvailabilitySlot()]);
                } else {
                    setAvailabilityType("24_7");
                    setCustomWeeklySlots([createAvailabilitySlot()]);
                }

                setAuctionStartPrice(
                    s.auction_start_price_gbp == null ? DEFAULT_AUCTION_START_PRICE : String(s.auction_start_price_gbp)
                );
                setAuctionEndLocal(toLocalDateTimeInput(s.auction_end) || dateTimeMonthsFromNow(1));
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
        if (mode === "free") {
            setAllowPoints(false);
            setPrice("0");
        }
        if (mode === "auction") {
            setPrice("0");
            if (!auctionStartPrice || Number(auctionStartPrice) < MIN_AUCTION_START_PRICE_GBP) {
                setAuctionStartPrice(DEFAULT_AUCTION_START_PRICE);
            }
            if (!auctionEndLocal) {
                setAuctionEndLocal(dateTimeMonthsFromNow(1));
            }
        }
        if (mode === "rent" && (!price || Number(price) <= 0)) {
            setPrice("5");
        }
    }, [mode, price, auctionStartPrice, auctionEndLocal]);

    useEffect(() => {
        if (allowPoints && (!pointsCost || Number(pointsCost) < MIN_POINTS_COST)) {
            setPointsCost(DEFAULT_POINTS_COST);
        }
    }, [allowPoints, pointsCost]);

    async function searchAddressSuggestions(rawQuery: string, manualSearch = false) {
        const query = rawQuery.trim();
        if (query.length < 3) {
            setAddressSuggestions([]);
            setAddressDropdownOpen(false);
            setAddressSearchBusy(false);
            addressSearchAbortRef.current?.abort();
            if (manualSearch) {
                setAddressSearchMessage("Enter at least 3 characters to search.");
            } else {
                setAddressSearchMessage("");
            }
            return;
        }

        addressSearchAbortRef.current?.abort();
        const controller = new AbortController();
        addressSearchAbortRef.current = controller;
        setAddressSearchBusy(true);
        setAddressSearchMessage("");

        try {
            const params = new URLSearchParams({
                format: "jsonv2",
                limit: "12",
                addressdetails: "1",
                countrycodes: "gb",
                viewbox: LONDON_VIEWBOX,
                q: query,
            });
            const lookup = await apiGet<{ suggestions: GeocodeSuggestion[] }>(
                `/parking-spots/geocode/search?${params.toString()}`,
                token || undefined,
                { signal: controller.signal }
            );
            const raw = lookup.suggestions ?? [];
            const next = Array.isArray(raw)
                ? raw
                      .filter((item, index, arr) => arr.findIndex((x) => x.display_name === item.display_name) === index)
                      .slice(0, 5)
                : [];
            setAddressSuggestions(next);
            setAddressDropdownOpen(next.length > 0);
            if (manualSearch && next.length === 0) {
                setAddressSearchMessage("No close matches found. Try adding a postcode or city.");
            }
        } catch (e: any) {
            if (e?.name !== "AbortError") {
                setAddressSuggestions([]);
                setAddressDropdownOpen(false);
                if (manualSearch) {
                    setAddressSearchMessage("Address search is unavailable right now. Please try again.");
                }
            }
        } finally {
            if (addressSearchAbortRef.current === controller) {
                setAddressSearchBusy(false);
            }
        }
    }

    useEffect(() => {
        const query = addressText.trim();
        if (suppressSuggestRef.current) {
            suppressSuggestRef.current = false;
            return;
        }
        if (query.length < 3) {
            setAddressSuggestions([]);
            setAddressDropdownOpen(false);
            setAddressSearchBusy(false);
            setAddressSearchMessage("");
            addressSearchAbortRef.current?.abort();
            return;
        }

        const timeoutId = window.setTimeout(() => {
            void searchAddressSuggestions(query, false);
        }, 280);

        return () => window.clearTimeout(timeoutId);
    }, [addressText]);

    useEffect(() => {
        const onPointerDown = (event: MouseEvent) => {
            if (!addressLookupRef.current) return;
            if (!addressLookupRef.current.contains(event.target as Node)) {
                setAddressDropdownOpen(false);
            }
        };
        document.addEventListener("mousedown", onPointerDown);
        return () => document.removeEventListener("mousedown", onPointerDown);
    }, []);

    useEffect(() => {
        return () => {
            addressSearchAbortRef.current?.abort();
            reverseLookupAbortRef.current?.abort();
        };
    }, []);

    function openSetupModal(nextMode: Mode) {
        setMode(nextMode);
        setSetupTypeDraft(parkingType);
        setSetupSpacesDraft(capacityTotal || "1");
        setShowSetupModal(true);
    }

    function saveSetupModal() {
        const spaces = Math.floor(Number(setupSpacesDraft || 1));
        if (!Number.isInteger(spaces) || spaces <= 0) {
            setError("Number of spaces must be at least 1.");
            return;
        }
        setError("");
        setParkingType(setupTypeDraft);
        setCapacityTotal(String(spaces));
        setCapacityAvailable(String(spaces));
        setShowSetupModal(false);
    }

    function scrollToSection(section: FormSectionKey) {
        const sectionMap: Record<FormSectionKey, HTMLDivElement | null> = {
            intro: introSectionRef.current,
            type: typeSectionRef.current,
            availability: availabilitySectionRef.current,
            pricing: pricingSectionRef.current,
            location: locationSectionRef.current,
        };
        const sectionNode = sectionMap[section];
        if (!sectionNode) return;
        sectionNode.scrollIntoView({ behavior: "smooth", block: "center" });
        const firstField = sectionNode.querySelector<HTMLElement>("input, textarea, select, button");
        if (firstField) {
            window.setTimeout(() => firstField.focus({ preventScroll: true }), 140);
        }
    }

    function setErrorWithScroll(message: string, section: FormSectionKey) {
        setError(message);
        scrollToSection(section);
    }

    function updateCustomSlot(slotId: string, patch: Partial<Omit<AvailabilitySlot, "id">>) {
        setCustomWeeklySlots((prev) => prev.map((slot) => (slot.id === slotId ? { ...slot, ...patch } : slot)));
    }

    function addCustomSlot() {
        const last = customWeeklySlots[customWeeklySlots.length - 1];
        setCustomWeeklySlots((prev) => [
            ...prev,
            createAvailabilitySlot({ dow: last?.dow ?? 1, start: last?.start ?? "09:00", end: last?.end ?? "17:00" }),
        ]);
    }

    function removeCustomSlot(slotId: string) {
        setCustomWeeklySlots((prev) => {
            const next = prev.filter((slot) => slot.id !== slotId);
            return next.length > 0 ? next : [createAvailabilitySlot()];
        });
    }

    function setupSummaryLabel() {
        const spotCount = Math.max(1, Math.floor(Number(capacityTotal || 1)));
        return `${spotCount} ${parkingTypeDisplayLabel(parkingType)} Parking Space${spotCount === 1 ? "" : "s"}`;
    }

    function availabilitySummaryLabel() {
        if (availabilityType === "24_7") return "24/7";
        if (availabilityType === "same_everyday") return `Same Time, Daily (${sameStart}-${sameEnd})`;
        return customWeeklySlots
            .map((slot) => `${DAY_LABELS[slot.dow].slice(0, 3)} ${slot.start}-${slot.end}`)
            .join(", ");
    }

    function pricingSummaryLabel() {
        if (mode === "free") return "Free Listing";
        if (mode === "auction") {
            const startingBid = Number(auctionStartPrice || 0);
            return `Auction Starting At £${Number.isFinite(startingBid) ? startingBid.toFixed(2) : "0.00"}`;
        }
        const amount = Number(price || 0);
        return `£${Number.isFinite(amount) ? amount.toFixed(2) : "0.00"} Per ${toTitleCaseWords(priceUnit)}`;
    }

    function applyPickedLocation(nextLat: number, nextLng: number, nextAddress?: string) {
        setLat(nextLat.toFixed(6));
        setLng(nextLng.toFixed(6));
        if (nextAddress) {
            suppressSuggestRef.current = true;
            setAddressText(nextAddress);
        }
        setAddressSuggestions([]);
        setAddressDropdownOpen(false);
        setAddressSearchMessage("");
    }

    async function reverseLookupAddress(nextLat: number, nextLng: number) {
        reverseLookupAbortRef.current?.abort();
        const controller = new AbortController();
        reverseLookupAbortRef.current = controller;
        setReverseLookupBusy(true);
        try {
            const params = new URLSearchParams({
                lat: String(nextLat),
                lng: String(nextLng),
            });
            const data = await apiGet<{ display_name?: string }>(
                `/parking-spots/geocode/reverse?${params.toString()}`,
                token || undefined,
                { signal: controller.signal }
            );
            if (data?.display_name) {
                suppressSuggestRef.current = true;
                setAddressText(data.display_name);
                setAddressSuggestions([]);
                setAddressDropdownOpen(false);
            }
        } catch (e: any) {
            if (e?.name !== "AbortError") {
                // Keep coordinates even if reverse lookup fails
            }
        } finally {
            if (reverseLookupAbortRef.current === controller) {
                setReverseLookupBusy(false);
            }
        }
    }

    function onMapPick(nextLat: number, nextLng: number) {
        applyPickedLocation(nextLat, nextLng);
        void reverseLookupAddress(nextLat, nextLng);
    }

    function onSelectAddressSuggestion(suggestion: GeocodeSuggestion) {
        const nextLat = Number(suggestion.lat);
        const nextLng = Number(suggestion.lon);
        if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) return;
        applyPickedLocation(nextLat, nextLng, suggestion.display_name);
    }

    function onAddressSearchClick() {
        void searchAddressSuggestions(addressText, true);
    }

    function onImageFileChange(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        if (!file) return;
        if (file.size > 4 * 1024 * 1024) {
            setError("Image is too large. Please use a file under 4MB.");
            event.target.value = "";
            return;
        }
        setError("");
        setSelectedImageName(file.name);
        const reader = new FileReader();
        reader.onload = () => setImageUrl(typeof reader.result === "string" ? reader.result : "");
        reader.onerror = () => setError("Could not read image file.");
        reader.readAsDataURL(file);
    }

    function clearImage() {
        setImageUrl("");
        setSelectedImageName("");
        if (imageInputRef.current) imageInputRef.current.value = "";
    }

    function buildAvailabilityPayload() {
        const dateFields = dateFrom || dateTo ? { date_from: dateFrom || undefined, date_to: dateTo || undefined } : {};

        if (availabilityType === "24_7") {
            return { type: "24_7", ...dateFields };
        }

        if (availabilityType === "same_everyday") {
            if (!isTime(sameStart) || !isTime(sameEnd) || minutes(sameStart) >= minutes(sameEnd)) {
                throw new Error("Same-everyday availability needs valid start and end times.");
            }
            return { type: "same_everyday", start: sameStart, end: sameEnd, ...dateFields };
        }

        const selectedDays = customWeeklySlots.map((slot) => ({
            dow: Number(slot.dow),
            start: slot.start,
            end: slot.end,
        }));
        if (selectedDays.length === 0) {
            throw new Error("Add at least one custom day/time slot.");
        }
        for (const slot of selectedDays) {
            if (!Number.isInteger(slot.dow) || slot.dow < 0 || slot.dow > 6) {
                throw new Error("Each custom availability row needs a valid day.");
            }
            if (!isTime(slot.start) || !isTime(slot.end) || minutes(slot.start) >= minutes(slot.end)) {
                throw new Error("Each custom availability row needs valid start and end times.");
            }
        }
        return { type: "custom_weekly", rules: selectedDays, ...dateFields };
    }

    function buildSubmitPayload() {
        const coords = parseCoordinates(lat, lng);
        const priceNum = Number(price || 0);
        const pointsNum = Number(pointsCost || 0);
        const capacityTotalNum = Math.floor(Number(capacityTotal || 1));
        const capacityAvailableNum = Math.floor(Number(capacityAvailable || 1));

        if (!title.trim() || title.trim().length < 3) {
            setErrorWithScroll("Title must be at least 3 characters.", "intro");
            return null;
        }
        if (!description.trim() || description.trim().length < 5) {
            setErrorWithScroll("Description must be at least 5 characters.", "intro");
            return null;
        }
        if (!addressText.trim() || addressText.trim().length < 5) {
            setErrorWithScroll("Address must be at least 5 characters.", "location");
            return null;
        }
        if (!coords) {
            setErrorWithScroll("Pick a valid location using address search or by clicking on the map.", "location");
            return null;
        }
        if (mode === "rent" && (!Number.isFinite(priceNum) || priceNum <= 0)) {
            setErrorWithScroll("Rent listings need a price above 0.", "pricing");
            return null;
        }
        if (allowPoints && (!Number.isFinite(pointsNum) || pointsNum < MIN_POINTS_COST)) {
            setErrorWithScroll("Points cost must be at least 1 when enabled.", "pricing");
            return null;
        }
        if (!Number.isInteger(capacityTotalNum) || capacityTotalNum <= 0) {
            setErrorWithScroll("Capacity total must be at least 1.", "type");
            return null;
        }
        if (!Number.isInteger(capacityAvailableNum) || capacityAvailableNum < 0) {
            setErrorWithScroll("Capacity available must be 0 or higher.", "type");
            return null;
        }
        if (capacityAvailableNum > capacityTotalNum) {
            setErrorWithScroll("Capacity available cannot exceed total.", "type");
            return null;
        }
        if (dateFrom && dateTo && dateFrom > dateTo) {
            setErrorWithScroll("Availability start date must be before end date.", "availability");
            return null;
        }

        let availability;
        try {
            availability = buildAvailabilityPayload();
        } catch (e: any) {
            setErrorWithScroll(e?.message || "Availability is invalid.", "availability");
            return null;
        }

        const payload: Record<string, any> = {
            title: title.trim(),
            description: description.trim(),
            mode,
            price_gbp: mode === "rent" ? priceNum : 0,
            price_unit: priceUnit,
            allow_points: mode === "free" ? false : allowPoints,
            points_cost: mode === "free" ? 0 : allowPoints ? pointsNum : 0,
            address_text: addressText.trim(),
            lat: coords.lat,
            lng: coords.lng,
            image_url: imageUrl.trim() || null,
            availability,
            parking_type: parkingType,
            capacity_total: capacityTotalNum,
            capacity_available: capacityAvailableNum,
        };

        if (mode === "auction") {
            const auctionStartNum = Number(auctionStartPrice || 0);
            const auctionEndIso = toIsoFromLocalInput(auctionEndLocal);
            if (!Number.isFinite(auctionStartNum) || auctionStartNum < MIN_AUCTION_START_PRICE_GBP) {
                setErrorWithScroll("Auction start price must be at least £0.10.", "pricing");
                return null;
            }
            if (!auctionEndIso) {
                setErrorWithScroll("Auction end date/time is required.", "pricing");
                return null;
            }
            if (!dateFrom || !dateTo) {
                setErrorWithScroll("Auction listings need availability start and end dates.", "availability");
                return null;
            }
            payload.auction_start_price_gbp = auctionStartNum;
            payload.auction_end = auctionEndIso;
        }

        return payload;
    }

    async function onSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!token) {
            setError("Please sign in to continue.");
            return;
        }

        setError("");
        setSuccess("");
        const payload = buildSubmitPayload();
        if (!payload) return;

        if (isEdit && editId) {
            setSaving(true);
            try {
                await apiPatch<{ parking_spot: ParkingSpot }>(`/parking-spots/${editId}`, payload, token);
                setSuccess("Listing updated.");
            } catch (e: any) {
                setError(e?.message || "Failed to save listing.");
            } finally {
                setSaving(false);
            }
            return;
        }

        setPendingPayload(payload);
        setShowConfirmModal(true);
    }

    async function onConfirmPublish() {
        if (!token || !pendingPayload || isEdit) return;
        setConfirmingPublish(true);
        setError("");
        try {
            const res = await apiPost<{ parking_spot: ParkingSpot }>("/parking-spots", pendingPayload, token);
            setShowConfirmModal(false);
            setPendingPayload(null);
            navigate(`/spots/${res.parking_spot.id}`, { replace: true });
        } catch (e: any) {
            setError(e?.message || "Failed to publish listing.");
        } finally {
            setConfirmingPublish(false);
        }
    }

    async function onDeleteListing() {
        if (!token || !editId) return;
        setDeleting(true);
        setError("");
        try {
            await apiDelete<{ deleted: boolean }>(`/parking-spots/${editId}`, token);
            navigate("/dashboard", { replace: true });
        } catch (e: any) {
            setError(e?.message || "Failed to delete listing.");
            setDeleting(false);
            setShowDeleteModal(false);
        }
    }

    if (!token) {
        return (
            <div className="container">
                <div className="formNarrow">
                    <div className="pageHeader">
                        <div className="heroKicker">LISTINGS</div>
                        <div className="heroTitle">Sign in to create a listing</div>
                        <div className="heroSub muted">You need an account before publishing listings.</div>
                    </div>
                    <div className="card formSection">
                        <div className="rowInline">
                            <Link to="/login" className="btn btn-primary">
                                Log in
                            </Link>
                            <Link to="/signup" className="btn">
                                Sign up
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="container">
            <div className="formNarrow">
                <div className="pageHeader">
                    <div className="heroKicker">{isEdit ? "EDIT LISTING" : "CREATE LISTING"}</div>
                    <div className="heroTitle">{isEdit ? "Update your listing" : "Publish a new listing"}</div>
                    <div className="heroSub muted">Signed in as {user?.name ?? "member"}.</div>
                </div>

                {loadingExisting ? (
                    <div className="card formSection">
                        <div className="muted">Loading listing details...</div>
                    </div>
                ) : (
                    <form className="formGrid createListingForm" onSubmit={onSubmit}>
                        <div ref={introSectionRef} className="card formSection formSection--intro">
                            <div className="sectionHeader">
                                <div className="h3">1. Name and description</div>
                                {isEdit && <span className="badge badge--warm">Editing</span>}
                            </div>
                            <label>
                                <span>Listing name</span>
                                <input
                                    className="input"
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    placeholder="Example: Secure driveway near station"
                                />
                            </label>
                            <label>
                                <span>Description</span>
                                <textarea
                                    className="input"
                                    rows={4}
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    placeholder="Describe access, entry notes, size limits, and anything drivers should know."
                                />
                            </label>
                        </div>

                        <div ref={typeSectionRef} className="card formSection formSection--type">
                            <div className="h3">2. Listing type</div>
                            <div className="listingTypeGrid">
                                <button
                                    type="button"
                                    className={`listingTypeCard listingTypeCard--rent${mode === "rent" ? " is-active" : ""}`}
                                    onClick={() => openSetupModal("rent")}
                                >
                                    <div className="listingTypeTitle">Rent</div>
                                    <div className="listingTypeCopy">Paid listing with fixed price.</div>
                                </button>
                                <button
                                    type="button"
                                    className={`listingTypeCard listingTypeCard--auction${mode === "auction" ? " is-active" : ""}`}
                                    onClick={() => openSetupModal("auction")}
                                >
                                    <div className="listingTypeTitle">Auction</div>
                                    <div className="listingTypeCopy">Highest bid wins before the end time.</div>
                                </button>
                                <button
                                    type="button"
                                    className={`listingTypeCard listingTypeCard--free${mode === "free" ? " is-active" : ""}`}
                                    onClick={() => openSetupModal("free")}
                                >
                                    <div className="listingTypeTitle">Free</div>
                                    <div className="listingTypeCopy">No payment required.</div>
                                </button>
                            </div>
                            <div className="setupSummaryCard">
                                <div className="setupSummaryText">
                                    <strong>{setupSummaryLabel()}</strong>
                                </div>
                                <button
                                    type="button"
                                    className="btn"
                                    onClick={() => {
                                        setSetupTypeDraft(parkingType);
                                        setSetupSpacesDraft(capacityTotal || "1");
                                        setShowSetupModal(true);
                                    }}
                                >
                                    Edit
                                </button>
                            </div>
                        </div>

                        <div ref={availabilitySectionRef} className="card formSection formSection--availability">
                            <div className="h3">3. Availability</div>
                            <div className="availabilityTypeGrid" role="tablist" aria-label="Availability options">
                                <button
                                    type="button"
                                    className={`availabilityTypeBtn availabilityTypeBtn--custom${
                                        availabilityType === "custom_weekly" ? " is-active" : ""
                                    }`}
                                    onClick={() => setAvailabilityType("custom_weekly")}
                                >
                                    Custom Time
                                </button>
                                <button
                                    type="button"
                                    className={`availabilityTypeBtn availabilityTypeBtn--same${
                                        availabilityType === "same_everyday" ? " is-active" : ""
                                    }`}
                                    onClick={() => setAvailabilityType("same_everyday")}
                                >
                                    Same Time, Daily
                                </button>
                                <button
                                    type="button"
                                    className={`availabilityTypeBtn availabilityTypeBtn--always${
                                        availabilityType === "24_7" ? " is-active" : ""
                                    }`}
                                    onClick={() => setAvailabilityType("24_7")}
                                >
                                    24/7
                                </button>
                            </div>
                            <div className="row">
                                <label>
                                    <span>Start date</span>
                                    <input
                                        className="input"
                                        type="date"
                                        value={dateFrom}
                                        onChange={(e) => setDateFrom(e.target.value)}
                                    />
                                </label>
                                <label>
                                    <span>End date</span>
                                    <input
                                        className="input"
                                        type="date"
                                        value={dateTo}
                                        onChange={(e) => setDateTo(e.target.value)}
                                    />
                                </label>
                            </div>

                            {availabilityType === "same_everyday" && (
                                <div className="row">
                                    <label>
                                        <span>Start time</span>
                                        <input
                                            className="input"
                                            type="time"
                                            value={sameStart}
                                            onChange={(e) => setSameStart(e.target.value)}
                                        />
                                    </label>
                                    <label>
                                        <span>End time</span>
                                        <input
                                            className="input"
                                            type="time"
                                            value={sameEnd}
                                            onChange={(e) => setSameEnd(e.target.value)}
                                        />
                                    </label>
                                </div>
                            )}

                            {availabilityType === "custom_weekly" && (
                                <div className="stack">
                                    {customWeeklySlots.map((slot) => (
                                        <div className="customSlotRow" key={slot.id}>
                                            <label>
                                                <span>Day</span>
                                                <select
                                                    value={slot.dow}
                                                    onChange={(e) =>
                                                        updateCustomSlot(slot.id, { dow: Number(e.target.value) })
                                                    }
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
                                                    onChange={(e) =>
                                                        updateCustomSlot(slot.id, { start: e.target.value })
                                                    }
                                                />
                                            </label>
                                            <label>
                                                <span>End</span>
                                                <input
                                                    className="input"
                                                    type="time"
                                                    value={slot.end}
                                                    onChange={(e) =>
                                                        updateCustomSlot(slot.id, { end: e.target.value })
                                                    }
                                                />
                                            </label>
                                            <button
                                                type="button"
                                                className="btn btn-danger"
                                                onClick={() => removeCustomSlot(slot.id)}
                                                disabled={customWeeklySlots.length === 1}
                                            >
                                                Remove
                                            </button>
                                        </div>
                                    ))}
                                    <div className="rowInline">
                                        <button type="button" className="btn" onClick={addCustomSlot}>
                                            + More dates and time
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div ref={pricingSectionRef} className="card formSection formSection--setupPricing">
                            <div className="h3">4. Pricing</div>
                            <div className="stack">
                                {mode === "rent" && (
                                    <div className="row">
                                        <label>
                                            <span>Price unit</span>
                                            <select
                                                value={priceUnit}
                                                onChange={(e) => setPriceUnit(e.target.value as PriceUnit)}
                                            >
                                                <option value="hour">Hour</option>
                                                <option value="day">Day</option>
                                                <option value="week">Week</option>
                                            </select>
                                        </label>
                                        <label>
                                            <span>Price (GBP)</span>
                                            <input
                                                className="input"
                                                type="number"
                                                min="0"
                                                step="0.5"
                                                value={price}
                                                onChange={(e) => setPrice(e.target.value)}
                                            />
                                        </label>
                                    </div>
                                )}

                                {mode === "auction" && (
                                    <div className="row">
                                        <label>
                                            <span>Starting bid per hour (GBP)</span>
                                            <input
                                                className="input"
                                                type="number"
                                                min="0.1"
                                                step="0.1"
                                                value={auctionStartPrice}
                                                onChange={(e) => setAuctionStartPrice(e.target.value)}
                                            />
                                        </label>
                                        <label>
                                            <span>Auction end date/time</span>
                                            <input
                                                className="input"
                                                type="datetime-local"
                                                value={auctionEndLocal}
                                                onChange={(e) => setAuctionEndLocal(e.target.value)}
                                            />
                                        </label>
                                    </div>
                                )}

                                {mode === "free" && (
                                    <div className="modeInfoNote">Free listings do not require a money price.</div>
                                )}

                                <div className="pointsQuickCard">
                                    <label className="chip" style={{ justifyContent: "flex-start" }}>
                                        <input
                                            type="checkbox"
                                            checked={allowPoints}
                                            disabled={mode === "free"}
                                            onChange={(e) => setAllowPoints(e.target.checked)}
                                        />
                                        <span>Allow points payment</span>
                                    </label>
                                    {mode === "free" && (
                                        <span className="pointsDisabledNote">Points payment is disabled for free listings.</span>
                                    )}
                                    {allowPoints && mode !== "free" && (
                                        <label>
                                            <span>Points cost</span>
                                            <input
                                                className="input"
                                                type="number"
                                                min="1"
                                                step="1"
                                                value={pointsCost}
                                                onChange={(e) => setPointsCost(e.target.value)}
                                            />
                                        </label>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div ref={locationSectionRef} className="card formSection formSection--location">
                            <div className="sectionHeader">
                                <div className="h3">5. Location</div>
                            </div>
                            <div className="addressLookupWrap" ref={addressLookupRef}>
                                <label>
                                    <span>Address</span>
                                    <div className="addressInputRow">
                                        <input
                                            className="input"
                                            value={addressText}
                                            onChange={(e) => {
                                                setAddressText(e.target.value);
                                                setAddressSearchMessage("");
                                            }}
                                            onFocus={() => setAddressDropdownOpen(addressSuggestions.length > 0)}
                                            onKeyDown={(event) => {
                                                if (event.key !== "Enter") return;
                                                event.preventDefault();
                                                onAddressSearchClick();
                                            }}
                                            placeholder="Start typing an address (e.g. 295 Upper Street)"
                                            autoComplete="off"
                                        />
                                        <button
                                            type="button"
                                            className="btn btn-primary addressSearchBtn"
                                            disabled={addressSearchBusy}
                                            onClick={onAddressSearchClick}
                                        >
                                            {addressSearchBusy ? "Searching..." : "Search"}
                                        </button>
                                    </div>
                                </label>
                                {addressSearchMessage && <div className="addressLookupStatus">{addressSearchMessage}</div>}
                                {addressSearchBusy && <div className="addressLookupStatus muted">Searching address options...</div>}
                                {addressDropdownOpen && addressSuggestions.length > 0 && (
                                    <div className="addressSuggestList" role="listbox" aria-label="Address suggestions">
                                        {addressSuggestions.map((suggestion) => (
                                            <button
                                                key={`${suggestion.place_id}-${suggestion.lat}-${suggestion.lon}`}
                                                type="button"
                                                className="addressSuggestItem"
                                                onClick={() => onSelectAddressSuggestion(suggestion)}
                                            >
                                                {suggestion.display_name}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div className="locationHelp muted">
                                Click anywhere on the map to place your pin and auto-fill the nearest real address.
                            </div>
                            {reverseLookupBusy && <div className="addressLookupStatus muted">Finding the closest address...</div>}
                            <div className="mapWrap mapWrap--pin createListingMap">
                                <div className="leafletShell">
                                    <MapContainer center={mapCenter} zoom={13} className="leafletMap">
                                        <MapRecenter center={mapCenter} />
                                        <TileLayer
                                            attribution='&copy; OpenStreetMap contributors'
                                            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                                        />
                                        <MapPickerPin position={markerPosition} onPick={onMapPick} />
                                    </MapContainer>
                                </div>
                            </div>
                        </div>

                        <div className="card formSection formSection--media">
                            <div className="sectionHeader">
                                <div className="h3">6. Listing image</div>
                                <span className="badge">Optional</span>
                            </div>
                            <div className="muted">
                                Upload one clear photo so drivers can quickly identify the parking space.
                            </div>
                            <input
                                ref={imageInputRef}
                                className="srOnlyInput"
                                type="file"
                                accept="image/*"
                                onChange={onImageFileChange}
                            />
                            <div className="uploadRow">
                                <button type="button" className="btn btn-primary" onClick={() => imageInputRef.current?.click()}>
                                    {imageUrl ? "Change image" : "Choose image"}
                                </button>
                                <span className="uploadFileName">{selectedImageName || "No file selected"}</span>
                                {imageUrl && (
                                    <button type="button" className="btn" onClick={clearImage}>
                                        Remove image
                                    </button>
                                )}
                            </div>
                            <div className="uploadHint muted">Supported formats: PNG, JPG, WEBP. Max size: 4MB.</div>
                            <div className="listingImagePreviewWrap">
                                {imageUrl ? (
                                    <img src={imageUrl} alt="Listing preview" className="listingImagePreview" />
                                ) : (
                                    <div className="listingImageEmpty">Image preview will appear here.</div>
                                )}
                            </div>
                        </div>

                        <div className="card formSection">
                            {error && <div className="spotAlert">{error}</div>}
                            {success && <div className="badge badge--green">{success}</div>}
                            <div className="rowInline">
                                <button className="btn btn-primary" type="submit" disabled={saving || deleting}>
                                    {saving ? "Saving..." : isEdit ? "Save changes" : "Publish listing"}
                                </button>
                                <Link className="btn" to={isEdit && editId ? `/spots/${editId}` : "/dashboard"}>
                                    Cancel
                                </Link>
                                {isEdit && (
                                    <button
                                        type="button"
                                        className="btn btn-danger"
                                        disabled={saving || deleting}
                                        onClick={() => setShowDeleteModal(true)}
                                    >
                                        Delete listing
                                    </button>
                                )}
                            </div>
                        </div>
                    </form>
                )}
            </div>

            {showSetupModal && (
                <div
                    className="modalOverlay"
                    role="dialog"
                    aria-modal="true"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) setShowSetupModal(false);
                    }}
                >
                    <div className="modalCard">
                        <div className="receiptCard">
                            <div className="receiptHeader">
                                <div className="h2">Setup details</div>
                                <div className="muted">Choose if this listing is private or public, and how many spaces it has.</div>
                            </div>
                            <div className="receiptBody">
                                <div className="availabilityTypeGrid" role="tablist" aria-label="Parking type options">
                                    <button
                                        type="button"
                                        className={`availabilityTypeBtn${setupTypeDraft === "private" ? " is-active" : ""}`}
                                        onClick={() => setSetupTypeDraft("private")}
                                    >
                                        Private
                                    </button>
                                    <button
                                        type="button"
                                        className={`availabilityTypeBtn${setupTypeDraft === "public" ? " is-active" : ""}`}
                                        onClick={() => setSetupTypeDraft("public")}
                                    >
                                        Public
                                    </button>
                                </div>
                                <label>
                                    <span>How many spaces?</span>
                                    <input
                                        className="input"
                                        type="number"
                                        min="1"
                                        value={setupSpacesDraft}
                                        onChange={(e) => setSetupSpacesDraft(e.target.value)}
                                    />
                                </label>
                            </div>
                            <div className="receiptActions">
                                <button type="button" className="btn" onClick={() => setShowSetupModal(false)}>
                                    Cancel
                                </button>
                                <button type="button" className="btn btn-primary" onClick={saveSetupModal}>
                                    Save setup
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {showConfirmModal && !isEdit && (
                <div
                    className="modalOverlay"
                    role="dialog"
                    aria-modal="true"
                    onClick={(e) => {
                        if (e.target === e.currentTarget && !confirmingPublish) {
                            setShowConfirmModal(false);
                            setPendingPayload(null);
                        }
                    }}
                >
                    <div className="modalCard">
                        <div className="receiptCard receiptCard--confirm">
                            <div className="receiptHeader">
                                <div className="h2">Confirm Listing</div>
                                <div className="muted">Review every detail below, then publish your listing.</div>
                            </div>
                            <div className="receiptBody">
                                <div className="receiptRow">
                                    <span className="receiptRowLabel">Listing Name</span>
                                    <strong className="receiptRowValue">{title || "-"}</strong>
                                </div>
                                <div className="receiptRow">
                                    <span className="receiptRowLabel">Type</span>
                                    <strong className="receiptRowValue">{modeDisplayLabel(mode)}</strong>
                                </div>
                                <div className="receiptRow">
                                    <span className="receiptRowLabel">Setup</span>
                                    <strong className="receiptRowValue">{setupSummaryLabel()}</strong>
                                </div>
                                <div className="receiptRow">
                                    <span className="receiptRowLabel">Availability</span>
                                    <strong className="receiptRowValue">{availabilitySummaryLabel() || "-"}</strong>
                                </div>
                                <div className="receiptRow">
                                    <span className="receiptRowLabel">Pricing</span>
                                    <strong className="receiptRowValue">{pricingSummaryLabel()}</strong>
                                </div>
                                <div className="receiptRow">
                                    <span className="receiptRowLabel">Address</span>
                                    <strong className="receiptRowValue">{addressText || "-"}</strong>
                                </div>
                            </div>
                            <div className="receiptActions">
                                <button
                                    type="button"
                                    className="btn"
                                    disabled={confirmingPublish}
                                    onClick={() => {
                                        setShowConfirmModal(false);
                                        setPendingPayload(null);
                                    }}
                                >
                                    Go back
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-primary"
                                    disabled={confirmingPublish}
                                    onClick={onConfirmPublish}
                                >
                                    {confirmingPublish ? "Publishing..." : "Confirm And Publish"}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {showDeleteModal && (
                <div
                    className="modalOverlay"
                    role="dialog"
                    aria-modal="true"
                    onClick={(e) => {
                        if (e.target === e.currentTarget && !deleting) setShowDeleteModal(false);
                    }}
                >
                    <div className="modalCard">
                        <div className="receiptCard">
                            <div className="receiptHeader">
                                <div className="h2">Delete this listing?</div>
                                <div className="muted">This action is permanent and removes the listing for all users.</div>
                            </div>
                            <div className="receiptBody">
                                <div className="receiptRow">
                                    <span>Title</span>
                                    <strong>{title || "Untitled listing"}</strong>
                                </div>
                                <div className="receiptRow">
                                    <span>Address</span>
                                    <strong>{addressText || "-"}</strong>
                                </div>
                            </div>
                            <div className="receiptActions">
                                <button type="button" className="btn" disabled={deleting} onClick={() => setShowDeleteModal(false)}>
                                    Keep listing
                                </button>
                                <button type="button" className="btn btn-danger" disabled={deleting} onClick={onDeleteListing}>
                                    {deleting ? "Deleting..." : "Delete permanently"}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
