import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { apiGet, apiPatch, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";

import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";

// Fix default marker icons in Vite builds
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: markerIcon2x,
    iconUrl: markerIcon,
    shadowUrl: markerShadow,
});

type Mode = "free" | "rent" | "auction";
type PriceUnit = "hour" | "day" | "week";
type AvailabilityType = "24_7" | "same_everyday" | "custom_weekly";
type ParkingType = "private" | "public";

type WeeklyRule = {
    id: string;
    dow: number; // 0..6
    start: string; // "HH:MM"
    end: string; // "HH:MM"
};

const DOW = [
    { id: 0, label: "Sun" },
    { id: 1, label: "Mon" },
    { id: 2, label: "Tue" },
    { id: 3, label: "Wed" },
    { id: 4, label: "Thu" },
    { id: 5, label: "Fri" },
    { id: 6, label: "Sat" },
];

function uid() {
    return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function clamp(n: number, min: number, max: number) {
    return Math.max(min, Math.min(max, n));
}

function toNumber(x: any, fallback = 0) {
    const n = Number(x);
    return Number.isFinite(n) ? n : fallback;
}

function toDateTimeLocal(iso: string) {
    try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return "";
        const pad = (n: number) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
            d.getMinutes()
        )}`;
    } catch {
        return "";
    }
}

async function compressImageToDataUrl(file: File, maxW = 1200, quality = 0.75): Promise<string> {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const el = new Image();
        el.onload = () => {
            URL.revokeObjectURL(url);
            resolve(el);
        };
        el.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("Failed to load image"));
        };
        el.src = url;
    });

    const scale = Math.min(1, maxW / img.width);
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not supported");
    ctx.drawImage(img, 0, 0, w, h);

    return canvas.toDataURL("image/jpeg", quality);
}



function Recenter({ lat, lng, zoom }: { lat: number; lng: number; zoom?: number }) {
    const map = useMap();
    // Keep it subtle: only recenter when coords change meaningfully.
    // Leaflet handles this well.
    map.setView([lat, lng], zoom ?? map.getZoom(), { animate: false });
    return null;
}

function MapClicker({ onPick }: { onPick: (lat: number, lng: number) => void }) {
    useMapEvents({
        click: (e) => onPick(e.latlng.lat, e.latlng.lng),
    });
    return null;
}

export default function CreateListingPage() {
    const { token, isLoading } = useAuth();
    const nav = useNavigate();
    const [searchParams] = useSearchParams();
    const editId = searchParams.get("edit");
    const isEdit = Boolean(editId);

    // basics
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");

    // mode + pricing
    const [mode, setMode] = useState<Mode>("rent");
    const [priceUnit, setPriceUnit] = useState<PriceUnit>("hour");
    const [priceGbp, setPriceGbp] = useState<number>(5);
    const [parkingType, setParkingType] = useState<ParkingType>("private");
    const [capacityTotal, setCapacityTotal] = useState<number>(1);
    const [capacityAvailable, setCapacityAvailable] = useState<number>(1);

    // points
    const [allowPoints, setAllowPoints] = useState(false);
    const [pointsCost, setPointsCost] = useState<number>(50);

    // auction
    const [auctionStartPrice, setAuctionStartPrice] = useState<number>(5);
    const [auctionEnd, setAuctionEnd] = useState<string>(""); // datetime-local

    // image
    // image (single photo)
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [imageUrl, setImageUrl] = useState("");
    const [useImageUrl, setUseImageUrl] = useState(false);
    // location
    const [addressQuery, setAddressQuery] = useState("");
    const [addressConfirmedText, setAddressConfirmedText] = useState<string>("");
    const [addressCandidates, setAddressCandidates] = useState<any[]>([]);
    const [selectedCandidateIdx, setSelectedCandidateIdx] = useState<number>(-1);
    const [locLat, setLocLat] = useState<number>(51.5074);
    const [locLng, setLocLng] = useState<number>(-0.1278);
    const [locationConfirmed, setLocationConfirmed] = useState(false);
    const [geoLoading, setGeoLoading] = useState(false);
    const [pinMode, setPinMode] = useState(false);

    // availability
    const [availabilityType, setAvailabilityType] = useState<AvailabilityType>("custom_weekly");
    const [everydayStart, setEverydayStart] = useState("09:00");
    const [everydayEnd, setEverydayEnd] = useState("17:00");
    const [availabilityDateFrom, setAvailabilityDateFrom] = useState<string>("");
    const [availabilityDateTo, setAvailabilityDateTo] = useState<string>("");
    const [weeklyRules, setWeeklyRules] = useState<WeeklyRule[]>([
        { id: uid(), dow: 1, start: "18:00", end: "22:00" },
    ]);

    // status
    const [msg, setMsg] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [loadingEdit, setLoadingEdit] = useState(false);
    const [showPreview, setShowPreview] = useState(false);

    const isFree = mode === "free";
    const isAuction = mode === "auction";

    useEffect(() => {
        if (isFree) {
            setAllowPoints(false);
            setPointsCost(0);
        }
    }, [isFree]);

    const unitLabel = useMemo(() => {
        if (priceUnit === "hour") return "per hour";
        if (priceUnit === "day") return "per day";
        return "per week";
    }, [priceUnit]);

    useEffect(() => {
        if (!isEdit || !editId || !token) return;
        setLoadingEdit(true);
        setMsg(null);
        apiGet<{ parking_spot: any }>(`/parking-spots/${editId}`, token)
            .then((res) => {
                const s = res.parking_spot;
                if (!s) return;

                setTitle(s.title ?? "");
                setDescription(s.description ?? "");
                setMode(s.mode ?? "rent");
                setPriceUnit(s.price_unit ?? "hour");
                setPriceGbp(toNumber(s.price_gbp, 0));
                setParkingType(s.parking_type ?? "private");
                setCapacityTotal(toNumber(s.capacity_total, 1));
                setCapacityAvailable(toNumber(s.capacity_available, 1));

                setAllowPoints(Boolean(s.allow_points));
                setPointsCost(toNumber(s.points_cost, 0));

                setAuctionStartPrice(toNumber(s.auction_start_price_gbp, 5));
                setAuctionEnd(s.auction_end ? toDateTimeLocal(s.auction_end) : "");

                setImageUrl(s.image_url ?? "");
                setImagePreviewUrl(s.image_url ?? null);
                setUseImageUrl(Boolean(s.image_url));

                setAddressQuery(s.address_text ?? "");
                setAddressConfirmedText(s.address_text ?? "");
                setLocLat(toNumber(s.lat, 51.5074));
                setLocLng(toNumber(s.lng, -0.1278));
                setLocationConfirmed(true);

                const av = s.availability_json ?? s.availability ?? null;
                if (av?.type === "24_7") {
                    setAvailabilityType("24_7");
                } else if (av?.type === "same_everyday") {
                    setAvailabilityType("same_everyday");
                    setEverydayStart(av.start ?? "09:00");
                    setEverydayEnd(av.end ?? "17:00");
                } else if (av?.type === "custom_weekly") {
                    setAvailabilityType("custom_weekly");
                    const rules = Array.isArray(av.rules) ? av.rules : [];
                    setWeeklyRules(
                        rules.length
                            ? rules.map((r: any) => ({
                                  id: uid(),
                                  dow: Number(r.dow ?? 1),
                                  start: r.start ?? "18:00",
                                  end: r.end ?? "22:00",
                              }))
                            : [{ id: uid(), dow: 1, start: "18:00", end: "22:00" }]
                    );
                }
                if (av?.date_from) setAvailabilityDateFrom(av.date_from);
                if (av?.date_to) setAvailabilityDateTo(av.date_to);
            })
            .catch((err) => {
                setMsg(err instanceof Error ? err.message : "Failed to load listing.");
            })
            .finally(() => setLoadingEdit(false));
    }, [isEdit, editId, token]);

    if (isLoading) {
        return (
            <div className="container">
                <div className="card" style={{ padding: 14 }}>
                    Loading…
                </div>
            </div>
        );
    }
    if (!token) return <Navigate to="/" replace />;

    function setError(text: string) {
        setMsg(text);
    }

    function setSuccess(text: string) {
        setMsg(`✅ ${text}`);
    }

    async function searchAddress() {
        setMsg(null);

        const q = addressQuery.trim();
        if (q.length < 5) return setError("Type a more specific address first.");

        setGeoLoading(true);
        try {
            const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&q=${encodeURIComponent(
                q
            )}`;

            const res = await fetch(url, { headers: { Accept: "application/json" } });
            const data = await res.json();

            if (!Array.isArray(data) || data.length === 0) {
                setAddressCandidates([]);
                setSelectedCandidateIdx(-1);
                setLocationConfirmed(false);
                setAddressConfirmedText("");
                return setError("No results found. Add a city or postcode.");
            }

            setAddressCandidates(data);
            setSelectedCandidateIdx(0);
            setLocationConfirmed(false);

            const best = data[0];
            const lat = toNumber(best.lat, locLat);
            const lng = toNumber(best.lon, locLng);
            setLocLat(lat);
            setLocLng(lng);
            setAddressConfirmedText(best.display_name ?? q);
        } catch {
            setError("Couldn’t reach the address search. Try again.");
        } finally {
            setGeoLoading(false);
        }
    }

    function selectCandidate(i: number) {
        const c = addressCandidates[i];
        if (!c) return;

        setSelectedCandidateIdx(i);
        const lat = toNumber(c.lat, locLat);
        const lng = toNumber(c.lon, locLng);
        setLocLat(lat);
        setLocLng(lng);

        setAddressConfirmedText(c.display_name ?? addressQuery.trim());
        setLocationConfirmed(false);
    }

    function confirmLocation() {
        if (!addressConfirmedText.trim()) return setError("Search and select an address first.");
        setLocationConfirmed(true);
        setMsg(null);
    }

    function addRule() {
        setWeeklyRules((prev) => [...prev, { id: uid(), dow: 1, start: "18:00", end: "22:00" }]);
    }

    function removeRule(id: string) {
        setWeeklyRules((prev) => prev.filter((r) => r.id !== id));
    }

    function updateRule(id: string, patch: Partial<WeeklyRule>) {
        setWeeklyRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    }

    function validateAvailability(): string | null {
        if (availabilityDateFrom && availabilityDateTo && availabilityDateFrom > availabilityDateTo) {
            return "Availability start date must be before end date.";
        }
        if (availabilityType === "24_7") return null;

        if (availabilityType === "same_everyday") {
            if (!everydayStart || !everydayEnd) return "Set start and end time.";
            if (everydayStart >= everydayEnd) return "Start must be before end.";
            return null;
        }

        if (weeklyRules.length === 0) return "Add at least one day/time rule.";
        for (const r of weeklyRules) {
            if (!r.start || !r.end) return "Each rule needs start and end time.";
            if (r.start >= r.end) return "Rule start must be before end.";
            if (r.dow < 0 || r.dow > 6) return "Invalid day of week.";
        }
        return null;
    }

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        setMsg(null);

        const t = title.trim();
        const d = description.trim();

        if (t.length < 3) return setError("Title must be at least 3 characters.");
        if (d.length < 5) return setError("Description must be at least 5 characters.");

        if (!addressConfirmedText.trim()) return setError("Search and select an address.");
        if (!locationConfirmed) return setError("Confirm the address before creating the listing.");

        const avErr = validateAvailability();
        if (avErr) return setError(avErr);

        // pricing (no state mutation here)
        const safePrice = toNumber(priceGbp, 0);
        const priceToSend = isFree || isAuction ? 0 : safePrice;

        if (!isFree && !isAuction) {
            if (!Number.isFinite(priceToSend) || priceToSend <= 0) return setError("Rent price must be greater than 0.");
        }
        if (parkingType === "public" && capacityTotal <= 0) {
            return setError("Capacity must be greater than 0 for public parking.");
        }
        if (capacityAvailable > capacityTotal) {
            return setError("Available spaces cannot exceed total capacity.");
        }

        const pointsToSend = allowPoints ? toNumber(pointsCost, 0) : 0;
        if (allowPoints && pointsToSend <= 0) return setError("Points cost must be greater than 0.");

        let auctionEndIso: string | null = null;
        if (isAuction) {
            const startP = toNumber(auctionStartPrice, 0);
            if (startP <= 0) return setError("Auction start price must be greater than 0.");
            if (!auctionEnd) return setError("Auction end date/time is required.");

            const dt = new Date(auctionEnd);
            if (Number.isNaN(dt.getTime())) return setError("Auction end date/time is invalid.");
            auctionEndIso = dt.toISOString();
        }

        const availabilityPayload =
            availabilityType === "24_7"
                ? { type: "24_7" }
                : availabilityType === "same_everyday"
                    ? { type: "same_everyday", start: everydayStart, end: everydayEnd }
                    : {
                        type: "custom_weekly",
                        rules: weeklyRules.map((r) => ({ dow: r.dow, start: r.start, end: r.end })),
                    };
        if (availabilityDateFrom) (availabilityPayload as any).date_from = availabilityDateFrom;
        if (availabilityDateTo) (availabilityPayload as any).date_to = availabilityDateTo;

        if (isAuction && (!availabilityDateFrom || !availabilityDateTo)) {
            return setError("Auction listings must include an availability date range.");
        }

        const payload = {
                title: t,
                description: d,
                mode,

                price_gbp: priceToSend,
                price_unit: priceUnit,

                allow_points: Boolean(allowPoints),
                points_cost: pointsToSend,

                address_text: addressConfirmedText,
                lat: Number(locLat),
                lng: Number(locLng),

                image_url: imageUrl.trim() || null,

                parking_type: parkingType,
                capacity_total: parkingType === "public" ? capacityTotal : 1,
                capacity_available: parkingType === "public" ? capacityAvailable : 1,

                // keep BOTH for compatibility with whatever you currently store/read
                availability: availabilityPayload,
                availability_json: availabilityPayload,

                auction_start_price_gbp: isAuction ? Number(auctionStartPrice) : null,
                auction_end: isAuction ? auctionEndIso : null,
            };

        if (!showPreview) {
            setShowPreview(true);
            return;
        }

        setSubmitting(true);
        try {
            if (isEdit && editId) {
                await apiPatch(`/parking-spots/${editId}`, payload, token);
                setSuccess("Listing updated.");
                setTimeout(() => nav(`/spots/${editId}`), 450);
            } else {
                await apiPost("/parking-spots", payload, token);
                setSuccess("Listing created.");
                setTimeout(() => nav("/", { state: { refresh: Date.now() } }), 450);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to create listing.");
        } finally {
            setSubmitting(false);
        }
    }

    {
        const locationStatus = locationConfirmed
            ? "Confirmed"
            : addressConfirmedText
                ? "Not confirmed"
                : "Not set";

        return (
            <div className="container">
                <div className="pageHeader formNarrow">
                    <div className="heroKicker">LIST YOUR SPACE</div>
                    <div className="heroTitle">{isEdit ? "Edit listing" : "Create a listing"}</div>
                    <div className="heroSub muted">
                        {isEdit
                            ? "Update the details of your listing."
                            : "Share your parking spot with the community and start accepting bookings."}
                    </div>
                </div>

                <form onSubmit={onSubmit} className="formGrid formNarrow">
                    {/* Basics */}
                    <section className="card formSection">
                        <div className="sectionHeader">
                            <div className="h3">Information</div>
                            <span className="badge">{mode}</span>
                        </div>
                        <div className="sectionSub muted">
                            A clear title and short description help drivers choose your space.
                        </div>

                        <div className="row">
                            <label>
                                <span>Title</span>
                                <input
                                    className="input"
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    placeholder="e.g. Private driveway near Angel station"
                                />
                            </label>

                            <label>
                                <span>Mode</span>
                                <select className="input" value={mode}
                                        onChange={(e) => setMode(e.target.value as Mode)}>
                                    <option value="rent">rent</option>
                                    <option value="free">free</option>
                                    <option value="auction">auction</option>
                                </select>
                            </label>
                        </div>

                        <label>
                            <span>Description</span>
                            <textarea
                                className="input"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                rows={4}
                                placeholder="Gate code, size limits, covered spot, anything useful."
                            />
                        </label>
                    </section>

                    {/* Pricing */}
                    <section className="card formSection">
                        <div className="sectionHeader">
                            <div className="h3">Pricing</div>
                            {isFree && <span className="badge">Free</span>}
                            {isAuction && <span className="badge">Auction</span>}
                        </div>
                        <div className="sectionSub muted">
                            {isAuction ? "Set your starting price and end time." : "Choose a price and time unit."}
                        </div>
                        {!isAuction ? (
                            <div className="row">
                                <label>
                                    <span>Price (£)</span>
                                    <input
                                        className="input"
                                        type="number"
                                        min={0}
                                        step="0.5"
                                        value={isFree ? 0 : priceGbp}
                                        onChange={(e) => setPriceGbp(toNumber(e.target.value, 0))}
                                        disabled={isFree}
                                    />
                                </label>

                                <label>
                                    <span>Per</span>
                                    <select
                                        className="input"
                                        value={priceUnit}
                                        onChange={(e) => setPriceUnit(e.target.value as PriceUnit)}
                                        disabled={isFree}
                                    >
                                        <option value="hour">hour</option>
                                        <option value="day">day</option>
                                        <option value="week">week</option>
                                    </select>
                                </label>
                            </div>
                        ) : (
                            <div className="row">
                                <label>
                                    <span>Auction start price (£)</span>
                                    <input
                                        className="input"
                                        type="number"
                                        min={1}
                                        step="0.5"
                                        value={auctionStartPrice}
                                        onChange={(e) => setAuctionStartPrice(toNumber(e.target.value, 1))}
                                    />
                                </label>

                                <label>
                                    <span>Auction end</span>
                                    <input
                                        className="input"
                                        type="datetime-local"
                                        value={auctionEnd}
                                        onChange={(e) => setAuctionEnd(e.target.value)}
                                    />
                                </label>
                            </div>
                        )}
                    </section>

                    {/* Parking type */}
                    <section className="card formSection">
                        <div className="sectionHeader">
                            <div className="h3">Parking type</div>
                            <span className="badge">{parkingType}</span>
                        </div>
                        <div className="sectionSub muted">
                            Use Public for large car parks with multiple bays.
                        </div>

                        <div className="row">
                            <label>
                                <span>Type</span>
                                <select
                                    className="input"
                                    value={parkingType}
                                    onChange={(e) => setParkingType(e.target.value as ParkingType)}
                                >
                                    <option value="private">Private space</option>
                                    <option value="public">Public parking</option>
                                </select>
                            </label>

                            <label>
                                <span>Total spaces</span>
                                <input
                                    className="input"
                                    type="number"
                                    min={1}
                                    step="1"
                                    value={capacityTotal}
                                    onChange={(e) => {
                                        const v = toNumber(e.target.value, 1);
                                        setCapacityTotal(v);
                                        if (capacityAvailable > v) setCapacityAvailable(v);
                                    }}
                                    disabled={parkingType !== "public"}
                                />
                            </label>
                        </div>

                        <label>
                            <span>Available spaces</span>
                            <input
                                className="input"
                                type="number"
                                min={0}
                                step="1"
                                value={capacityAvailable}
                                onChange={(e) => setCapacityAvailable(toNumber(e.target.value, 0))}
                                disabled={parkingType !== "public"}
                            />
                        </label>
                    </section>

                    {/* Availability */}
                    <section className="card formSection">
                        <div className="h3">Availability</div>
                        <div className="sectionSub muted">
                            Pick when drivers can book your space.
                        </div>

                        <div className="row">
                            <label>
                                <span>Available from (optional)</span>
                                <input
                                    className="input"
                                    type="date"
                                    value={availabilityDateFrom}
                                    onChange={(e) => setAvailabilityDateFrom(e.target.value)}
                                />
                            </label>
                            <label>
                                <span>Available until (optional)</span>
                                <input
                                    className="input"
                                    type="date"
                                    value={availabilityDateTo}
                                    onChange={(e) => setAvailabilityDateTo(e.target.value)}
                                />
                            </label>
                        </div>

                        <div className="chips">
                            <label className="chip" style={{cursor: "pointer"}}>
                                <input
                                    type="radio"
                                    name="av"
                                    checked={availabilityType === "custom_weekly"}
                                    onChange={() => setAvailabilityType("custom_weekly")}
                                />
                                Custom
                            </label>
                            <label className="chip" style={{cursor: "pointer"}}>
                                <input
                                    type="radio"
                                    name="av"
                                    checked={availabilityType === "same_everyday"}
                                    onChange={() => setAvailabilityType("same_everyday")}
                                />
                                Same time daily
                            </label>
                            <label className="chip" style={{cursor: "pointer"}}>
                                <input
                                    type="radio"
                                    name="av"
                                    checked={availabilityType === "24_7"}
                                    onChange={() => setAvailabilityType("24_7")}
                                />
                                24/7
                            </label>
                        </div>

                        {availabilityType === "same_everyday" && (
                            <div className="row" style={{marginTop: 10}}>
                                <label>
                                    <span>Start</span>
                                    <input className="input" type="time" value={everydayStart}
                                           onChange={(e) => setEverydayStart(e.target.value)}/>
                                </label>
                                <label>
                                    <span>End</span>
                                    <input className="input" type="time" value={everydayEnd}
                                           onChange={(e) => setEverydayEnd(e.target.value)}/>
                                </label>
                            </div>
                        )}

                        {availabilityType === "custom_weekly" && (
                            <div className="stack">
                                {weeklyRules.map((r) => (
                                    <div key={r.id} className="card"
                                         style={{padding: 12, background: "rgba(255,255,255,0.02)"}}>
                                        <div style={{
                                            display: "grid",
                                            gridTemplateColumns: "1fr 1fr 1fr auto",
                                            gap: 10,
                                            alignItems: "end"
                                        }}>
                                            <label>
                                                <span>Day</span>
                                                <select className="input" value={r.dow}
                                                        onChange={(e) => updateRule(r.id, {dow: Number(e.target.value)})}>
                                                    {DOW.map((d) => (
                                                        <option key={d.id} value={d.id}>
                                                            {d.label}
                                                        </option>
                                                    ))}
                                                </select>
                                            </label>

                                            <label>
                                                <span>Start</span>
                                                <input className="input" type="time" value={r.start}
                                                       onChange={(e) => updateRule(r.id, {start: e.target.value})}/>
                                            </label>

                                            <label>
                                                <span>End</span>
                                                <input className="input" type="time" value={r.end}
                                                       onChange={(e) => updateRule(r.id, {end: e.target.value})}/>
                                            </label>

                                            <button className="btn" type="button" onClick={() => removeRule(r.id)}>
                                                Remove
                                            </button>
                                        </div>
                                    </div>
                                ))}

                                <button className="btn btn-primary" type="button" onClick={addRule}
                                        style={{width: "fit-content"}}>
                                    + Add day/time
                                </button>
                            </div>
                        )}
                    </section>

                    {/* Points */}
                    <section className="card formSection">
                        <div className="sectionHeader">
                            <div className="h3">Points</div>
                            <label className="chip" style={{cursor: "pointer"}}>
                                <input type="checkbox" checked={allowPoints}
                                       onChange={(e) => setAllowPoints(e.target.checked)}
                                       disabled={isFree}/>
                                Allow points
                            </label>
                        </div>
                        <div className="sectionSub muted">
                            Reward points let drivers book using community credits.
                        </div>

                        <div className="row" style={{opacity: allowPoints ? 1 : 0.6}}>
                            <label>
                                <span>Points cost (per {priceUnit})</span>
                                <input
                                    className="input"
                                    type="number"
                                    min={0}
                                    step="1"
                                    value={allowPoints ? pointsCost : 0}
                                    disabled={!allowPoints}
                                    onChange={(e) => setPointsCost(toNumber(e.target.value, 0))}
                                />
                            </label>

                            <div className="muted tiny">
                                {isFree ? "Points are disabled for free listings." : "If enabled, users can pay with points instead of money."}
                            </div>
                        </div>
                    </section>

                    {/* Location */}
                    <section className="card formSection">
                        <div className="sectionHeader">
                            <div className="h3">Location</div>
                            <span className="badge">{locationStatus}</span>
                        </div>
                        <div className="sectionSub muted">
                            Search for your address or place a pin manually on the map.
                        </div>

                        <div className="row">
                            <label>
                                <span>Address</span>
                                <input
                                    className="input"
                                    value={addressQuery}
                                    onChange={(e) => setAddressQuery(e.target.value)}
                                    placeholder="e.g. 290 Upper Street, London"
                                />
                            </label>

                            <div style={{display: "grid", gap: 8, alignSelf: "end"}}>
                                <button className="btn btn-primary btn-full" type="button" onClick={searchAddress}
                                        disabled={geoLoading}>
                                    {geoLoading ? "Searching…" : "Search address"}
                                </button>
                                <button
                                    className="btn"
                                    type="button"
                                    onClick={() => setPinMode((p) => !p)}
                                >
                                    {pinMode ? "Cancel pin" : "Place pin manually"}
                                </button>

                            </div>
                        </div>

                        {addressCandidates.length > 0 && (
                            <div className="stack">
                                <div className="muted tiny">Choose the best match:</div>
                                {addressCandidates.map((c, i) => (
                                    <button
                                        type="button"
                                        key={String(c.place_id ?? i)}
                                        className={`btn ${i === selectedCandidateIdx ? "btn-primary" : ""}`}
                                        style={{justifyContent: "flex-start", textAlign: "left"}}
                                        onClick={() => selectCandidate(i)}
                                    >
                                        {c.display_name}
                                    </button>
                                ))}

                                <div className="rowInline">
                                    <button
                                        type="button"
                                        className={`btn ${locationConfirmed ? "btn-primary" : "btn-primary"}`}
                                        onClick={confirmLocation}
                                        disabled={locationConfirmed}
                                        style={{
                                            opacity: locationConfirmed ? 0.85 : 1,
                                            cursor: locationConfirmed ? "default" : "pointer",
                                        }}
                                    >
                                        {locationConfirmed ? "✅ Confirmed" : "Confirm this address"}
                                    </button>
                                    <div className="tiny muted">
                                        Address confirmed
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className={`mapWrap ${pinMode ? "mapWrap--pin" : ""}`} style={{height: 320}}>
                            <MapContainer center={[locLat, locLng]} zoom={16} className="leafletMap">
                                <Recenter lat={locLat} lng={locLng} zoom={16}/>
                                {pinMode && (
                                    <MapClicker
                                        onPick={(lat, lng) => {
                                            setLocLat(clamp(Number(lat), -90, 90));
                                            setLocLng(clamp(Number(lng), -180, 180));
                                            setAddressConfirmedText(`Pinned location (${lat.toFixed(5)}, ${lng.toFixed(5)})`);
                                            setLocationConfirmed(true);
                                            setPinMode(false);
                                            setMsg("Pin set. You can continue.");
                                        }}
                                    />
                                )}
                                <TileLayer attribution='&copy; OpenStreetMap contributors'
                                           url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
                                <Marker
                                    position={[locLat, locLng]}
                                    draggable={true}
                                    eventHandlers={{
                                        dragend: (e) => {
                                            const m = e.target as any;
                                            const p = m.getLatLng();
                                            setLocLat(clamp(Number(p.lat), -90, 90));
                                            setLocLng(clamp(Number(p.lng), -180, 180));
                                            setLocationConfirmed(true);
                                            setMsg(null);
                                        },
                                    }}
                                >
                                    <Popup>
                                        <div style={{maxWidth: 240}}>
                                            <strong>Pin location</strong>
                                            <div className="tiny muted" style={{marginTop: 6}}>
                                                Drag the pin to the exact spot.
                                            </div>
                                            <div className="tiny muted" style={{marginTop: 6}}>
                                                {locLat.toFixed(5)}, {locLng.toFixed(5)}
                                            </div>
                                        </div>
                                    </Popup>
                                </Marker>
                            </MapContainer>
                        </div>

                        <div className="tiny muted">
                            Pin: <strong>{locLat.toFixed(5)}, {locLng.toFixed(5)}</strong>
                        </div>
                    </section>

                    {/* Photo */}
                    <section className="card formSection">
                        <div className="sectionHeader">
                            <div className="h3">Photo</div>
                            <div className="muted tiny">Optional</div>
                        </div>
                        <div className="sectionSub muted">
                            One clear photo is enough for the listing preview.
                        </div>

                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            style={{ display: "none" }}
                            onChange={(e) => {
                                setMsg(null);
                                const f = e.target.files?.[0];
                                if (!f) return;

                                // keep it reasonable (base64 was the 413 culprit)
                                if (f.size > 5 * 1024 * 1024) {
                                    setError("Image too large. Choose a file under 5MB.");
                                    e.currentTarget.value = "";
                                    return;
                                }

                                setImageFile(f);

                                // demo-friendly: compress to keep payload below server limits
                                compressImageToDataUrl(f, 1200, 0.75)
                                    .then((dataUrl) => {
                                        setImageUrl(dataUrl);
                                        setImagePreviewUrl(dataUrl);
                                    })
                                    .catch(() => {
                                        setError("Failed to process image file.");
                                    });
                            }}
                        />
                        <div className="rowInline">
                            <button type="button" className="btn btn-primary" onClick={() => fileInputRef.current?.click()}>
                                Choose image…
                            </button>

                            {imageFile && (
                                <button
                                    type="button"
                                    className="btn"
                                    onClick={() => {
                                        setImageFile(null);
                                        setImagePreviewUrl((prev) => {
                                            if (prev) URL.revokeObjectURL(prev);
                                            return null;
                                        });
                                        if (fileInputRef.current) fileInputRef.current.value = "";
                                    }}
                                >
                                    Remove
                                </button>
                            )}

                            <div className="tiny muted">{imageFile?.name ?? "No image selected"}</div>
                        </div>

                        <label className="rowInline" style={{ alignItems: "center" }}>
                            <input
                                type="checkbox"
                                checked={useImageUrl}
                                onChange={(e) => setUseImageUrl(e.target.checked)}
                            />
                            <span className="muted tiny">Use image URL instead</span>
                        </label>

                        {useImageUrl && (
                            <label>
                                <span>Image URL</span>
                                <input
                                    className="input"
                                    value={imageUrl}
                                    onChange={(e) => setImageUrl(e.target.value)}
                                    placeholder="https://…"
                                />
                            </label>
                        )}

                        {imagePreviewUrl && (
                            <div>
                                <img
                                    src={imagePreviewUrl}
                                    alt="Listing preview"
                                    style={{
                                        width: "100%",
                                        maxHeight: 320,
                                        objectFit: "cover",
                                        borderRadius: 12,
                                        border: "1px solid rgba(255,255,255,0.10)",
                                    }}
                                />
                            </div>
                        )}
                    </section>

                    {/* Submit */}
                    <section className="rowInline">
                        <button className="btn btn-primary" type="submit" disabled={submitting || loadingEdit}>
                            {submitting ? (isEdit ? "Saving…" : "Creating…") : isEdit ? "Save changes" : "Create listing"}
                        </button>

                        <button className="btn" type="button" onClick={() => nav("/")}>
                            Cancel
                        </button>

                        {msg && (
                            <div className="tiny" style={{ color: msg.startsWith("✅") ? "var(--accent)" : "crimson" }}>
                                {msg}
                            </div>
                        )}
                    </section>
                </form>

                {showPreview && (
                    <div className="modalOverlay" role="dialog" aria-modal="true">
                        <div className="modalCard receiptCard">
                            <div className="receiptHeader">
                                <div className="h2">Listing preview</div>
                                <div className="muted tiny">Please confirm your details</div>
                            </div>
                            <div className="receiptBody">
                                <div className="receiptRow">
                                    <span className="muted">Title</span>
                                    <strong>{title || "Untitled"}</strong>
                                </div>
                                <div className="receiptRow">
                                    <span className="muted">Mode</span>
                                    <strong>{mode}</strong>
                                </div>
                                <div className="receiptRow">
                                    <span className="muted">Price</span>
                                    <strong>{isFree ? "Free" : isAuction ? "Auction" : `£${toNumber(priceGbp, 0).toFixed(2)} ${unitLabel}`}</strong>
                                </div>
                                <div className="receiptRow">
                                    <span className="muted">Address</span>
                                    <strong>{addressConfirmedText || "Pinned location"}</strong>
                                </div>
                                <div className="receiptRow">
                                    <span className="muted">Availability</span>
                                    <strong>{availabilityType === "24_7" ? "24/7" : availabilityType === "same_everyday" ? `Daily ${everydayStart}–${everydayEnd}` : "Custom weekly"}</strong>
                                </div>
                                {parkingType === "public" && (
                                    <div className="receiptRow">
                                        <span className="muted">Spaces</span>
                                        <strong>{capacityAvailable}/{capacityTotal} available</strong>
                                    </div>
                                )}
                            </div>
                            <div className="receiptActions">
                                <button className="btn" type="button" onClick={() => setShowPreview(false)}>
                                    Edit
                                </button>
                                <button
                                    className="btn btn-primary"
                                    type="button"
                                    onClick={(e) => onSubmit(e as any)}
                                    disabled={submitting}
                                >
                                    Confirm & submit
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }}
