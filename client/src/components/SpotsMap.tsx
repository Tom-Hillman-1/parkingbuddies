import { useEffect, useRef } from "react";
import type { Marker as LeafletMarker } from "leaflet";
import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents, ZoomControl } from "react-leaflet";
import { Link } from "react-router-dom";

export type MapSpot = {
    id: string;
    title: string;
    address_text: string;
    lat: number;
    lng: number;
    image_url: string | null;
    mode: "free" | "rent" | "auction";
    price_gbp: number | string | null | undefined;
    capacity_total?: number;
};

type PinState = "default" | "hovered" | "selected";

function makePin(state: PinState) {
    return L.divIcon({
        className: "",
        html: `<span class="map-pin map-pin--${state}" aria-hidden="true"></span>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        popupAnchor: [0, -12],
    });
}

const pinIcon = {
    default: makePin("default"),
    hovered: makePin("hovered"),
    selected: makePin("selected"),
};

function moneyLabel(value: number | string | null | undefined, mode?: MapSpot["mode"]) {
    const amount = Number(value ?? 0);

    if (mode === "auction") {
        if (!Number.isFinite(amount) || amount <= 0) return "Bid now";
        return `Bid from \u00A3${amount.toFixed(1)}`;
    }

    if (!Number.isFinite(amount) || amount <= 0) return "Free";
    return `\u00A3${amount.toFixed(2)}`;
}

function modeLabel(mode?: MapSpot["mode"]) {
    if (!mode) return "Unknown";
    return mode.charAt(0).toUpperCase() + mode.slice(1);
}

function Recenter({ center }: { center: { lat: number; lng: number } }) {
    const map = useMap();

    useEffect(() => {
        const zoom = map.getZoom();
        map.setView([center.lat, center.lng], zoom, { animate: true });
    }, [map, center.lat, center.lng]);

    return null;
}

function MapPickerEvents({ onMapPick }: { onMapPick?: (lat: number, lng: number) => void }) {
    useMapEvents({
        click(event) {
            onMapPick?.(event.latlng.lat, event.latlng.lng);
        },
    });
    return null;
}

export default function SpotsMap({
    spots,
    center = { lat: 51.5074, lng: -0.1278 },
    selectedId,
    hoveredId,
    onSelect,
    onHover,
    pickerPosition,
    onMapPick,
    showPopupDetails = true,
}: {
    spots: MapSpot[];
    center?: { lat: number; lng: number };
    selectedId?: string | null;
    hoveredId?: string | null;
    onSelect?: (id: string) => void;
    onHover?: (id: string | null) => void;
    pickerPosition?: { lat: number; lng: number } | null;
    onMapPick?: (lat: number, lng: number) => void;
    showPopupDetails?: boolean;
}) {
    const markerRefs = useRef<Record<string, LeafletMarker | null>>({});
    const previousHoveredId = useRef<string | null>(null);

    useEffect(() => {
        if (!showPopupDetails || !selectedId) return;
        markerRefs.current[selectedId]?.openPopup();
    }, [selectedId, spots, showPopupDetails]);

    useEffect(() => {
        const previous = previousHoveredId.current;

        if (previous && previous !== hoveredId && previous !== selectedId) {
            markerRefs.current[previous]?.closePopup();
        }

        if (showPopupDetails && hoveredId && hoveredId !== selectedId) {
            markerRefs.current[hoveredId]?.openPopup();
        }

        previousHoveredId.current = hoveredId ?? null;
    }, [hoveredId, selectedId, showPopupDetails]);

    return (
        <div className="leafletShell">
            <MapContainer center={[center.lat, center.lng]} zoom={13} className="leafletMap" zoomControl={false}>
                <Recenter center={center} />
                <MapPickerEvents onMapPick={onMapPick} />
                <ZoomControl position="topright" />

                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
                    url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                />

                {pickerPosition && (
                    <Marker
                        position={[pickerPosition.lat, pickerPosition.lng]}
                        icon={pinIcon.selected}
                    />
                )}

                {spots.map((spot) => {
                    const isSelected = selectedId === spot.id;
                    const isHovered = hoveredId === spot.id;

                    const icon = isSelected
                        ? pinIcon.selected
                        : isHovered
                            ? pinIcon.hovered
                            : pinIcon.default;

                    return (
                        <Marker
                            key={spot.id}
                            position={[spot.lat, spot.lng]}
                            icon={icon}
                            ref={(instance) => {
                                markerRefs.current[spot.id] = instance;
                            }}
                            eventHandlers={{
                                click: (event) => {
                                    onSelect?.(spot.id);
                                    onHover?.(spot.id);
                                    if (showPopupDetails) event.target.openPopup();
                                },
                                mouseover: (event) => {
                                    onHover?.(spot.id);
                                    if (showPopupDetails) event.target.openPopup();
                                },
                                mouseout: (event) => {
                                    onHover?.(null);
                                    if (showPopupDetails && !isSelected) {
                                        event.target.closePopup();
                                    }
                                },
                            }}
                        >
                            {showPopupDetails && (
                                <Popup className="map-popup">
                                    <div className="map-popup__body">
                                        {spot.image_url && (
                                            <img
                                                src={spot.image_url}
                                                alt={spot.title}
                                                className="map-popup__image"
                                                loading="lazy"
                                            />
                                        )}
                                        <div className="map-popup__title">{spot.title}</div>
                                        <div className="map-popup__address">{spot.address_text}</div>
                                        <div className="map-popup__meta">
                                            {moneyLabel(spot.price_gbp, spot.mode)} | {modeLabel(spot.mode)}
                                        </div>
                                        <Link to={`/spots/${spot.id}`} className="map-popup__link">View details</Link>
                                    </div>
                                </Popup>
                            )}
                        </Marker>
                    );
                })}
            </MapContainer>
        </div>
    );
}
