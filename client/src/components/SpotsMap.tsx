import { useEffect, useRef } from "react";
import type { Marker as LeafletMarker } from "leaflet";
import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import { Link } from "react-router-dom";
import type { ParkingSpot } from "../types";

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

function moneyLabel(value: number | string | null | undefined, mode?: ParkingSpot["mode"]) {
    const amount = Number(value ?? 0);

    if (mode === "auction") {
        if (!Number.isFinite(amount) || amount <= 0) return "Bid now";
        return `Bid from \u00A3${amount.toFixed(1)}`;
    }

    if (!Number.isFinite(amount) || amount <= 0) return "Free";
    return `\u00A3${amount.toFixed(2)}`;
}

function modeLabel(mode?: ParkingSpot["mode"]) {
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

export default function SpotsMap({
    spots,
    center = { lat: 51.5074, lng: -0.1278 },
    selectedId,
    hoveredId,
    onSelect,
    onHover,
}: {
    spots: ParkingSpot[];
    center?: { lat: number; lng: number };
    selectedId?: string | null;
    hoveredId?: string | null;
    onSelect?: (id: string) => void;
    onHover?: (id: string | null) => void;
}) {
    const markerRefs = useRef<Record<string, LeafletMarker | null>>({});
    const previousHoveredId = useRef<string | null>(null);

    useEffect(() => {
        if (!selectedId) return;
        markerRefs.current[selectedId]?.openPopup();
    }, [selectedId, spots]);

    useEffect(() => {
        const previous = previousHoveredId.current;

        if (previous && previous !== hoveredId && previous !== selectedId) {
            markerRefs.current[previous]?.closePopup();
        }

        if (hoveredId && hoveredId !== selectedId) {
            markerRefs.current[hoveredId]?.openPopup();
        }

        previousHoveredId.current = hoveredId ?? null;
    }, [hoveredId, selectedId]);

    return (
        <div className="leafletShell">
            <MapContainer center={[center.lat, center.lng]} zoom={13} className="leafletMap" zoomControl={false}>
                <Recenter center={center} />

                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
                    url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                />

                {spots.map((spot) => {
                    const isSelected = selectedId === spot.id;
                    const isHovered = hoveredId === spot.id;
                    const capacity = Math.max(1, Number(spot.capacity_total ?? 1));
                    const leftRaw = Number(spot.capacity_available);
                    const left = Number.isFinite(leftRaw) ? Math.max(0, leftRaw) : null;

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
                                    event.target.openPopup();
                                },
                                mouseover: (event) => {
                                    onHover?.(spot.id);
                                    event.target.openPopup();
                                },
                                mouseout: (event) => {
                                    onHover?.(null);
                                    if (!isSelected) {
                                        event.target.closePopup();
                                    }
                                },
                            }}
                        >
                            <Popup className="map-popup">
                                <div className="map-popup__body">
                                    <div className="map-popup__title">{spot.title}</div>
                                    <div className="map-popup__address">{spot.address_text}</div>
                                    <div className="map-popup__meta">
                                        {moneyLabel(spot.price_gbp, spot.mode)} | {modeLabel(spot.mode)}
                                    </div>
                                    {capacity > 1 && left != null && (
                                        <div className="map-popup__meta">{left}/{capacity} spots left</div>
                                    )}
                                    <Link to={`/spots/${spot.id}`} className="map-popup__link">View details</Link>
                                </div>
                            </Popup>
                        </Marker>
                    );
                })}
            </MapContainer>
        </div>
    );
}
