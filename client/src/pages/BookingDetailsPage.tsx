import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { apiGet } from "../lib/api";
import { useAuth } from "../lib/auth";
import SpotsMap from "../components/SpotsMap";

type BookingDetail = {
    id: string;
    status: "pending" | "confirmed" | "cancelled";
    pay_method: "money" | "points";
    total_price_gbp: any;
    total_points: number | null;
    start_time: string;
    end_time: string;
    created_at: string;
    parking_spot_id: string;
    spot_title: string;
    spot_address: string;
    spot_lat: number;
    spot_lng: number;
    spot_image?: string | null;
    spot_mode?: string;
    spot_price_gbp?: any;
    spot_price_unit?: string;
};

function toMoney(x: any) {
    const n = Number(x ?? 0);
    return Number.isFinite(n) ? n : 0;
}

function dt(s: string) {
    try {
        return new Date(s).toLocaleString();
    } catch {
        return s;
    }
}

export default function BookingDetailsPage() {
    const { id } = useParams<{ id: string }>();
    const { token } = useAuth();
    const [booking, setBooking] = useState<BookingDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        if (!id || !token) return;
        setLoading(true);
        setErr(null);
        apiGet<{ booking: BookingDetail }>(`/bookings/${id}`, token)
            .then((r) => setBooking(r.booking))
            .catch((e) => setErr(e.message || "Failed to load booking"))
            .finally(() => setLoading(false));
    }, [id, token]);

    const durationHours = useMemo(() => {
        if (!booking) return "0.00";
        const s = new Date(booking.start_time);
        const e = new Date(booking.end_time);
        const mins = (e.getTime() - s.getTime()) / 60000;
        return mins > 0 ? (mins / 60).toFixed(2) : "0.00";
    }, [booking?.start_time, booking?.end_time]);

    if (!token) return <Navigate to="/" replace />;
    if (loading) return <div className="container">Loading…</div>;
    if (err) return <div className="container" style={{ color: "crimson" }}>{err}</div>;
    if (!booking) return <div className="container">Not found</div>;

    const totalLabel =
        booking.pay_method === "points"
            ? `${booking.total_points ?? 0} pts`
            : `£${toMoney(booking.total_price_gbp).toFixed(2)}`;

    return (
        <div className="container">
            <div className="pageHeader">
                <div className="heroKicker">BOOKING</div>
                <div className="heroTitle">Your reservation</div>
                <div className="heroSub muted">Booking summary and time window.</div>
            </div>

            <div className="spotDetails">
                <aside className="spotMedia">
                    <Link to="/dashboard" className="muted tiny" style={{ textDecoration: "none" }}>
                        ← Back to dashboard
                    </Link>
                    <div className="card spotMediaCard">
                        {booking.spot_image ? (
                            <img src={booking.spot_image} alt={booking.spot_title} className="spotHeroImg" />
                        ) : (
                            <div className="spotHeroFallback">No photo</div>
                        )}
                    </div>
                    <div className="card spotMediaCard">
                        <div className="h3">Location map</div>
                        <div className="muted tiny" style={{ marginTop: 4 }}>Your booked spot.</div>
                        {Number.isFinite(booking.spot_lat) && Number.isFinite(booking.spot_lng) ? (
                            <div className="spotMapWrap" style={{ marginTop: 10 }}>
                                <SpotsMap
                                    spots={[{
                                        id: booking.parking_spot_id,
                                        lat: booking.spot_lat,
                                        lng: booking.spot_lng,
                                        title: booking.spot_title,
                                        address_text: booking.spot_address,
                                        mode: booking.spot_mode ?? "rent",
                                        price_gbp: booking.spot_price_gbp ?? 0,
                                    } as any]}
                                    center={{ lat: booking.spot_lat, lng: booking.spot_lng }}
                                    selectedId={booking.parking_spot_id}
                                />
                            </div>
                        ) : (
                            <div className="tiny muted" style={{ marginTop: 10 }}>Map unavailable.</div>
                        )}
                    </div>
                </aside>

                <main className="spotMain">
                    <div className="card spotHeader">
                        <div className="spotHeaderTop">
                            <div>
                                <div className="heroKicker">PARKINGBUDDIES</div>
                                <div className="heroTitle">{booking.spot_title}</div>
                                <div className="muted" style={{ marginTop: 6 }}>{booking.spot_address}</div>
                            </div>
                            <div className="pill">{booking.status}</div>
                        </div>
                    </div>

                    <div className="card receiptCard">
                        <div className="receiptHeader">
                            <div className="h2">Booking receipt</div>
                            <div className="muted tiny">Keep this for your records</div>
                        </div>
                        <div className="receiptBody">
                            <div className="receiptRow">
                                <span className="muted">Booked for</span>
                                <strong>{dt(booking.start_time)} → {dt(booking.end_time)}</strong>
                            </div>
                            <div className="receiptRow">
                                <span className="muted">Duration</span>
                                <strong>{durationHours} hours</strong>
                            </div>
                            <div className="receiptRow">
                                <span className="muted">Payment</span>
                                <strong>{booking.pay_method}</strong>
                            </div>
                            <div className="receiptRow">
                                <span className="muted">Total paid</span>
                                <strong>{totalLabel}</strong>
                            </div>
                            <div className="receiptRow">
                                <span className="muted">Booking ID</span>
                                <strong>{booking.id}</strong>
                            </div>
                        </div>
                        <div className="receiptActions">
                            <Link to={`/spots/${booking.parking_spot_id}`} className="btn">
                                View listing
                            </Link>
                            {booking.pay_method === "money" && Number(booking.total_price_gbp ?? 0) > 0 && booking.status === "pending" && (
                                <Link to={`/pay/${booking.id}`} className="btn btn-primary">
                                    Pay now
                                </Link>
                            )}
                        </div>
                    </div>
                </main>
            </div>
        </div>
    );
}
