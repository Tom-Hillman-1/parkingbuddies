import { useEffect, useRef } from "react";
import type { Marker as LeafletMarker } from "leaflet";
import L from "leaflet";
import markerIcon2xUrl from "leaflet/dist/images/marker-icon-2x.png";
import markerIconUrl from "leaflet/dist/images/marker-icon.png";
import markerShadowUrl from "leaflet/dist/images/marker-shadow.png";
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents, ZoomControl } from "react-leaflet";
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
    const scale = state === "selected" ? 1.12 : state === "hovered" ? 1.06 : 1;

    return new L.Icon({
        iconRetinaUrl: markerIcon2xUrl,
        iconUrl: markerIconUrl,
        shadowUrl: markerShadowUrl,
        iconSize: [25 * scale, 41 * scale],
        iconAnchor: [12.5 * scale, 41 * scale],
        popupAnchor: [0, -34 * scale],
        shadowSize: [41 * scale, 41 * scale],
        shadowAnchor: [13 * scale, 41 * scale],
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
    userLocation,
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
    userLocation?: { lat: number; lng: number } | null;
    showPopupDetails?: boolean;
}) {
    const markerRefs = useRef<Record<string, LeafletMarker | null>>({});

    useEffect(() => {
        if (!showPopupDetails || !selectedId) return;
        markerRefs.current[selectedId]?.openPopup();
    }, [selectedId, spots, showPopupDetails]);

    return (
        <div className="leafletShell">
            <MapContainer
                center={[center.lat, center.lng]}
                zoom={13}
                className="leafletMap"
                zoomControl={false}
                scrollWheelZoom={false}
            >
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

                {userLocation && (
                    <>
                        <CircleMarker
                            center={[userLocation.lat, userLocation.lng]}
                            radius={18}
                            pathOptions={{
                                stroke: false,
                                fillColor: "#2d82ff",
                                fillOpacity: 0.18,
                            }}
                        />
                        <CircleMarker
                            center={[userLocation.lat, userLocation.lng]}
                            radius={7}
                            pathOptions={{
                                color: "#ffffff",
                                weight: 3,
                                fillColor: "#2d82ff",
                                fillOpacity: 1,
                            }}
                        />
                    </>
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
                                mouseover: () => {
                                    onHover?.(spot.id);
                                },
                                mouseout: () => {
                                    onHover?.(null);
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
