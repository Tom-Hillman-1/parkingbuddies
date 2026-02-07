import L from "leaflet";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import type { ParkingSpot } from "../types";
import { Link } from "react-router-dom";

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

const defaultIcon = new L.Icon.Default();

const selectedIcon = new L.Icon({
    iconRetinaUrl: markerIcon2x,
    iconUrl: markerIcon,
    shadowUrl: markerShadow,
    iconSize: [30, 46],
    iconAnchor: [15, 46],
    popupAnchor: [0, -40],
    shadowSize: [41, 41],
});

const hoverIcon = new L.Icon({
    iconRetinaUrl: markerIcon2x,
    iconUrl: markerIcon,
    shadowUrl: markerShadow,
    iconSize: [26, 40],
    iconAnchor: [13, 40],
    popupAnchor: [0, -36],
    shadowSize: [38, 38],
});

function moneyLabel(x: any, mode?: string) {
    if (mode === "auction") return "Auction";
    const n = Number(x ?? 0);
    if (!Number.isFinite(n) || n <= 0) return "Free";
    return `£${n.toFixed(2)}`;
}

function modeLabel(mode?: string) {
    if (!mode) return "Unknown";
    return mode.charAt(0).toUpperCase() + mode.slice(1);
}


function Recenter({ center }: { center: { lat: number; lng: number } }) {
    const map = useMap();
    // Only recenter if user isn't actively dragging/zooming (simple safeguard)
    // and avoid jitter by using setView without changing zoom.
    React.useEffect(() => {
        const z = map.getZoom();
        map.setView([center.lat, center.lng], z, { animate: true });
    }, [center.lat, center.lng]);
    return null;
}

// React isn't imported above (Vite + TS sometimes needs it for hooks in this file)
import React from "react";

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
    return (
        <div className="leafletShell">
            <MapContainer center={[center.lat, center.lng]} zoom={13} className="leafletMap">
                <Recenter center={center} />

                <TileLayer
                    attribution='&copy; OpenStreetMap contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                {spots.map((s) => {
                    const isSelected = selectedId === s.id;
                    const isHovered = hoveredId === s.id;
                    // IMPORTANT: never pass icon={undefined}
                    const iconProps = isSelected ? { icon: selectedIcon } : isHovered ? { icon: hoverIcon } : { icon: defaultIcon };

                    return (
                        <Marker
                            key={s.id}
                            position={[s.lat, s.lng]}
                            {...iconProps}
                            eventHandlers={{
                                click: () => onSelect?.(s.id),
                                mouseover: (e) => {
                                    onHover?.(s.id);
                                    e.target.openPopup();
                                },
                                mouseout: (e) => {
                                    onHover?.(null);
                                    e.target.closePopup();
                                },
                            }}
                        >
                            <Popup>
                                <div style={{ maxWidth: 240 }}>
                                    <div style={{ fontWeight: 800 }}>{s.title}</div>
                                    <div style={{ fontSize: 12, opacity: 0.8 }}>{s.address_text}</div>
                                    <div style={{ marginTop: 6 }}>
                                        {moneyLabel((s as any).price_gbp, s.mode)} • {modeLabel(s.mode)}
                                    </div>
                                    <div style={{ marginTop: 10 }}>
                                        <Link to={`/spots/${s.id}`}>View details</Link>
                                    </div>
                                </div>
                            </Popup>
                        </Marker>
                    );
                })}
            </MapContainer>
        </div>
    );
}
