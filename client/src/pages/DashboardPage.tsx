import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { apiGet, apiPatch, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";

type Me = {
    id: string;
    email: string;
    name: string;
    points_balance: number;
};

type Booking = {
    id: string;
    parking_spot_id: string;
    driver_user_id: string;
    owner_user_id: string;
    status: "pending" | "confirmed" | "cancelled";
    pay_method: "money" | "points";
    total_price_gbp: any;
    total_points: number | null;
    start_time: string;
    end_time: string;
    created_at: string;
    spot_mode?: "free" | "rent" | "auction";
};

type ParkingSpot = {
    id: string;
    owner_user_id: string;
    title: string;
    address_text: string;
    mode: string;
    price_gbp: any;
    image_url?: string | null;
    is_active?: boolean;
    created_at?: string;
    auction_start_price_gbp?: number | null;
    auction_highest_pending_gbp?: number | null;
    auction_sold_out?: boolean;
};

type RewardTx = {
    id: string;
    user_id: string;
    type: "earn" | "spend";
    amount: number;
    reason: string;
    created_at: string;
};

type Payment = {
    id: string;
    booking_id: string;
    provider: string;
    status: string;
    amount_gbp: any;
    created_at: string;
    start_time: string;
    end_time: string;
    spot_title: string;
    spot_address: string;
};

type AuctionBid = {
    id: string;
    parking_spot_id: string;
    amount_gbp: any;
    status: string;
    created_at: string;
    start_time?: string;
    end_time?: string;
    bidder_name?: string;
    bidder_email?: string;
    spot_title?: string;
};

type MyAuctionBid = {
    id: string;
    parking_spot_id: string;
    amount_gbp: any;
    status: string;
    created_at: string;
    start_time?: string;
    end_time?: string;
    spot_title?: string;
};

function toMoney(x: any) {
    const n = Number(x ?? 0);
    return Number.isFinite(n) ? n : 0;
}

function dt(s: string) {
    // simple readable local time
    try {
        return new Date(s).toLocaleString();
    } catch {
        return s;
    }
}

export default function DashboardPage() {
    const { token, user, logout } = useAuth();
    const [searchParams] = useSearchParams();

    const [me, setMe] = useState<Me | null>(null);
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [ownerBookings, setOwnerBookings] = useState<Booking[]>([]);
    const [spots, setSpots] = useState<ParkingSpot[]>([]);
    const [rewards, setRewards] = useState<RewardTx[]>([]);
    const [payments, setPayments] = useState<Payment[]>([]);
    const [auctionBids, setAuctionBids] = useState<AuctionBid[]>([]);
    const [myAuctionBids, setMyAuctionBids] = useState<MyAuctionBid[]>([]);

    const [loading, setLoading] = useState(true);
    const [msg, setMsg] = useState<string | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [open, setOpen] = useState({
        ownerConfirmed: false,
        ownerPending: false,
        myBookings: false,
        myListings: false,
        myAuctionBids: false,
        payments: false,
        rewards: false,
        profile: false,
    });

    const isLoggedIn = !!token;

    async function loadAll() {
        if (!token) return;
        setLoading(true);
        setErr(null);
        setMsg(null);

        try {
            const [meRes, bookingsRes, ownerBookingsRes, rewardsRes, spotsRes, paymentsRes, bidsRes, myBidsRes] = await Promise.all([
                apiGet<{ user: Me }>("/me", token),
                apiGet<{ bookings: Booking[] }>("/bookings/me", token),
                apiGet<{ bookings: Booking[] }>("/bookings/owner", token),
                apiGet<{ rewards: RewardTx[] }>("/dashboard/rewards", token),
                apiGet<{ parking_spots: ParkingSpot[] }>("/parking-spots"),
                apiGet<{ payments: Payment[] }>("/payments/me", token),
                apiGet<{ bids: AuctionBid[] }>("/auctions/owner/bids", token),
                apiGet<{ bids: MyAuctionBid[] }>("/auctions/me/pending", token),
            ]);

            setMe(meRes.user);
            setBookings(bookingsRes.bookings ?? []);
            setOwnerBookings(ownerBookingsRes.bookings ?? []);
            setRewards(rewardsRes.rewards ?? []);
            setSpots(spotsRes.parking_spots ?? []);
            setPayments(paymentsRes.payments ?? []);
            setAuctionBids(bidsRes.bids ?? []);
            setMyAuctionBids(myBidsRes.bids ?? []);
        } catch (e: any) {
            setErr(e.message || "Failed to load dashboard");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        if (!token) return;
        loadAll();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);

    useEffect(() => {
        const tab = searchParams.get("tab");
        if (!tab) return;
        setOpen((p) => ({
            ...p,
            myBookings: tab === "myBookings" ? true : p.myBookings,
            myAuctionBids: tab === "myAuctionBids" ? true : p.myAuctionBids,
            ownerPending: tab === "ownerPending" ? true : p.ownerPending,
            ownerConfirmed: tab === "ownerConfirmed" ? true : p.ownerConfirmed,
            myListings: tab === "myListings" ? true : p.myListings,
        }));
    }, [searchParams]);

    const myListings = useMemo(() => {
        if (!me) return [];
        return spots.filter((s) => s.owner_user_id === me.id);
    }, [spots, me]);

    const spotById = useMemo(() => {
        return new Map(spots.map((s) => [s.id, s]));
    }, [spots]);

    const spotByTitle = useMemo(() => {
        return new Map(spots.map((s) => [s.title, s]));
    }, [spots]);

    const myBookings = useMemo(() => {
        if (!me) return [];
        // bookings/me should already be mine; we keep it as-is
        return bookings;
    }, [bookings, me]);

    const pendingOwnerCount = useMemo(() => {
        return auctionBids.filter((b) => String(b.status ?? "").toLowerCase() === "pending").length;
    }, [auctionBids]);

    const upcoming = useMemo(() => {
        const now = Date.now();
        const driverUpcoming = myBookings
            .filter((b) => new Date(b.start_time).getTime() >= now)
            .map((b) => ({ ...b, role: "Driver" as const }));
        const ownerUpcoming = ownerBookings
            .filter((b) => new Date(b.start_time).getTime() >= now && b.status === "confirmed")
            .map((b) => ({ ...b, role: "Owner" as const }));
        return [...driverUpcoming, ...ownerUpcoming]
            .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
            .slice(0, 6);
    }, [myBookings, ownerBookings]);

    async function cancelBooking(id: string) {
        if (!token) return;
        setBusyId(id);
        setMsg(null);
        setErr(null);

        try {
            await apiPatch<{ booking: Booking }>(`/bookings/${id}/cancel`, token);
            setMsg("Booking cancelled.");
            await loadAll();
        } catch (e: any) {
            setErr(e.message || "Cancel failed");
        } finally {
            setBusyId(null);
        }
    }

    if (!isLoggedIn) {
        return <Navigate to="/" replace />;
    }

    async function acceptBid(spotId: string, bidId: string) {
        if (!token) return;
        setBusyId(bidId);
        setMsg(null);
        setErr(null);
        try {
            await apiPost(`/auctions/${spotId}/accept`, { bid_id: bidId }, token);
            setMsg("Bid accepted.");
            await loadAll();
        } catch (e: any) {
            setErr(e.message || "Accept failed");
        } finally {
            setBusyId(null);
        }
    }

    async function rejectBid(spotId: string, bidId: string) {
        if (!token) return;
        setBusyId(bidId);
        setMsg(null);
        setErr(null);
        try {
            await apiPost(`/auctions/${spotId}/reject`, { bid_id: bidId }, token);
            setMsg("Bid rejected.");
            await loadAll();
        } catch (e: any) {
            setErr(e.message || "Reject failed");
        } finally {
            setBusyId(null);
        }
    }

    function renderThumb(imageUrl: string | null | undefined, label: string) {
        const letter = (label || "P").slice(0, 1).toUpperCase();
        return (
            <div className="thumb">
                {imageUrl ? (
                    <img src={imageUrl} alt={label} />
                ) : (
                    <div className="thumbFallback">{letter}</div>
                )}
            </div>
        );
    }

    return (
        <div className="container">
            <div className="rowInline" style={{ justifyContent: "flex-end", marginTop: 10 }}>
                <div className="rowInline" style={{ gap: 10 }}>
                    <span className="badge badge--green">
                        Total earned: £{ownerBookings
                            .filter((b) => b.status === "confirmed" && b.pay_method === "money")
                            .reduce((sum, b) => sum + toMoney(b.total_price_gbp), 0)
                            .toFixed(2)}
                    </span>
                </div>
            </div>

            <div className="rowInline" style={{ alignItems: "flex-end", justifyContent: "space-between", gap: 20, marginTop: 10 }}>
                <div className="pageHeader" style={{ textAlign: "left", marginBottom: 0 }}>
                    <div className="heroKicker">DASHBOARD</div>
                    <div className="heroTitle">Your activity</div>
                    <div className="heroSub muted">Manage bookings, listings, and rewards.</div>
                </div>
                {!loading && me && (
                    <div className="card profileCard profileCard--mini" style={{ marginTop: -2, marginBottom: 12, minWidth: 200, width: 200, maxWidth: "45%" }}>
                        <div className="profileGrid">
                            <div>
                                <div className="tiny muted" style={{ color: "#fff" }}>Name</div>
                                <div className="spotInfoValue muted" style={{ color: "#b8bcc4" }}>{me.name}</div>
                            </div>
                            <div>
                                <div className="tiny muted" style={{ color: "#fff" }}>Email</div>
                                <div className="spotInfoValue muted" style={{ color: "#b8bcc4" }}>{me.email}</div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {loading && <div className="card formSection">Loading...</div>}
            {err && <div className="card formSection" style={{ color: "crimson" }}>{err}</div>}
            {msg && <div className="card formSection">{msg}</div>}

            <div className="dashGrid" style={{ marginTop: 8 }}>
                <div className="card formSection">
                    <button
                        type="button"
                        className="sectionHeader sectionHeader--driver collapsibleHeader"
                        onClick={() => setOpen((p) => ({ ...p, myBookings: !p.myBookings }))}
                    >
                        <div className="sectionHeaderTitle">
                            <span className="sectionDot" />
                            <div className="h3">My bookings</div>
                        </div>
                        <span className="badge badge--cool sectionHeaderBadge">Total {myBookings.length}</span>
                    </button>
                    <div className="sectionSub muted">
                        Your own bookings as a driver.
                    </div>

                    {open.myBookings && (myBookings.length === 0 ? (
                        <div className="muted">No bookings yet.</div>
                    ) : (
                        <div className="stack">
                            {myBookings
                                .slice()
                                .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
                                .map((b) => {
                                    const price = toMoney(b.total_price_gbp);
                                    const spot = spotById.get(b.parking_spot_id);
                                    const title = spot?.title ?? "Parking spot";
                                    const address = spot?.address_text ?? "Address on file";
                                    return (
                                        <div key={b.id} className="card dashItem dashItem--driver">
                                            <div className="dashItemHeader">
                                                {renderThumb(spot?.image_url, title)}
                                                <div className="dashItemText">
                                                    <div className="dashItemTitle">{title}</div>
                                                    <div className="dashItemSubtitle">{address}</div>
                                                </div>
                                                <div className="dashItemPrice">
                                                    {b.pay_method === "money"
                                                        ? `£${price.toFixed(2)}`
                                                        : `${b.total_points ?? 0} pts`}
                                                </div>
                                            </div>
                                            <div className="dashMetaRow">
                                                <span className="badge">{b.status}</span>
                                                <span className="badge">{b.pay_method}</span>
                                            </div>
                                            <div className="dashField">
                                                <div className="dashLabel">Time</div>
                                                <div className="tiny muted">{dt(b.start_time)} → {dt(b.end_time)}</div>
                                            </div>

                                            <div className="rowInline" style={{ marginTop: 8 }}>
                                                <Link
                                                    to={`/bookings/${b.id}`}
                                                    className="btn"
                                                >
                                                    View booking
                                                </Link>

                                                {b.status === "pending" && b.pay_method === "money" && price > 0 && (
                                                    <Link
                                                        to={`/pay/${b.id}`}
                                                        className="btn btn-primary"
                                                    >
                                                        Pay
                                                    </Link>
                                                )}

                                                {b.status === "pending" && (
                                                    <button
                                                        onClick={() => cancelBooking(b.id)}
                                                        disabled={busyId === b.id}
                                                        className="btn"
                                                    >
                                                        Cancel
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                        </div>
                    ))}
                </div>

                <div className="card formSection">
                    <button
                        type="button"
                        className="sectionHeader sectionHeader--owner collapsibleHeader"
                        onClick={() => setOpen((p) => ({ ...p, myListings: !p.myListings }))}
                    >
                        <div className="sectionHeaderTitle">
                            <span className="sectionDot" />
                            <div className="h3">My listings</div>
                        </div>
                        <span className="badge badge--warm sectionHeaderBadge">Total {myListings.length}</span>
                    </button>
                    <div className="sectionSub muted">
                        Parking spaces you’ve published.
                    </div>

                    {open.myListings && (myListings.length === 0 ? (
                        <div className="muted">
                            No listings yet. <Link to="/create-listing">Create one</Link>.
                        </div>
                    ) : (
                        <div className="stack">
                            {myListings
                                .slice()
                                .sort((a, b) => ((a.created_at ?? "") < (b.created_at ?? "") ? 1 : -1))
                                .map((s) => {
                                    const price = toMoney(s.price_gbp);
                                    const auctionHighest = Number(s.auction_highest_pending_gbp ?? 0);
                                    const auctionStart = Number(s.auction_start_price_gbp ?? 0);
                                    const priceLabel = s.mode === "auction"
                                        ? (auctionHighest > 0 ? `£${auctionHighest.toFixed(2)}` : `Start £${auctionStart.toFixed(2)}`)
                                        : price > 0 ? `£${price.toFixed(2)}` : "Free";
                                    return (
                                        <div key={s.id} className="card dashItem dashItem--listings">
                                            <div className="dashItemHeader">
                                                {renderThumb(s.image_url, s.title)}
                                                <div className="dashItemText">
                                                    <div className="dashItemTitle">{s.title}</div>
                                                    <div className="dashItemSubtitle">{s.address_text}</div>
                                                </div>
                                                <div className="dashItemPrice">
                                                    {priceLabel}
                                                </div>
                                            </div>
                                            <div className="dashMetaRow">
                                                <span className="badge">{s.mode}</span>
                                                {s.mode === "auction" && s.auction_sold_out && (
                                                    <span className="badge badge--rose">Sold out</span>
                                                )}
                                                {s.is_active === false && <span className="badge">Inactive</span>}
                                            </div>

                                            <div className="rowInline" style={{ marginTop: 8 }}>
                                                <Link
                                                    to={`/spots/${s.id}`}
                                                    className="btn"
                                                >
                                                    View listing
                                                </Link>
                                                <Link
                                                    to={`/create-listing?edit=${s.id}`}
                                                    className="btn btn-primary"
                                                >
                                                    Edit listing
                                                </Link>
                                            </div>
                                        </div>
                                    );
                                })}
                        </div>
                    ))}
                </div>
            </div>

            <div className="dashGrid" style={{ marginTop: 14 }}>
                <div className="card formSection">
                    <button
                        type="button"
                        className="sectionHeader sectionHeader--driver collapsibleHeader"
                        onClick={() => setOpen((p) => ({ ...p, profile: !p.profile }))}
                    >
                        <div className="sectionHeaderTitle">
                            <span className="sectionDot" />
                            <div className="h3">My upcoming schedule</div>
                        </div>
                        <span className="badge badge--cool sectionHeaderBadge">{upcoming.length} upcoming</span>
                    </button>
                    <div className="sectionSub muted">
                        Your next bookings as a driver or owner.
                    </div>

                    {open.profile && (upcoming.length === 0 ? (
                        <div className="muted">No upcoming bookings.</div>
                    ) : (
                        <div className="stack">
                            {upcoming.map((b) => {
                                const spot = spotById.get(b.parking_spot_id);
                                const title = spot?.title ?? "Parking spot";
                                const address = spot?.address_text ?? "Address on file";
                                return (
                                    <div key={`${b.id}-${b.role}`} className="card dashItem dashItem--driver">
                                        <div className="dashItemHeader">
                                            {renderThumb(spot?.image_url, title)}
                                            <div className="dashItemText">
                                                <div className="dashItemTitle">{title}</div>
                                                <div className="dashItemSubtitle">{address}</div>
                                            </div>
                                            {b.pay_method === "money" && (
                                                <div className="dashItemPrice">£{toMoney(b.total_price_gbp).toFixed(2)}</div>
                                            )}
                                        </div>
                                        <div className="dashMetaRow">
                                            <span className="badge">{b.role}</span>
                                            <span className="badge">{b.status}</span>
                                        </div>
                                        <div className="dashField">
                                            <div className="dashLabel">Time</div>
                                            <div className="tiny muted">{dt(b.start_time)} → {dt(b.end_time)}</div>
                                        </div>
                                        <div className="rowInline" style={{ marginTop: 8 }}>
                                            <Link to={`/spots/${b.parking_spot_id}`} className="btn">
                                                View spot
                                            </Link>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
                <div className="card formSection">
                    <button
                        type="button"
                        className="sectionHeader sectionHeader--owner collapsibleHeader"
                        onClick={() => setOpen((p) => ({ ...p, ownerConfirmed: !p.ownerConfirmed }))}
                    >
                        <div className="sectionHeaderTitle">
                            <span className="sectionDot" />
                            <div className="h3">My booked listings</div>
                        </div>
                        <span className="badge badge--warm sectionHeaderBadge">
                            {ownerBookings.filter((b) => b.status === "confirmed").length} bookings confirmed
                        </span>
                    </button>
                    <div className="sectionSub muted">
                        Bookings other users made on your parking spaces.
                    </div>

                    {open.ownerConfirmed && (ownerBookings.filter((b) => b.status === "confirmed").length === 0 ? (
                        <div className="muted">No confirmed bookings yet.</div>
                    ) : (
                        <div className="stack">
                            {ownerBookings
                                .filter((b) => b.status === "confirmed")
                                .map((b) => {
                                    const spot = spotById.get(b.parking_spot_id);
                                    const title = spot?.title ?? "Parking spot";
                                    const address = spot?.address_text ?? "Address on file";
                                    return (
                                        <div key={b.id} className="card dashItem dashItem--owner">
                                            <div className="dashItemHeader">
                                                {renderThumb(spot?.image_url, title)}
                                                <div className="dashItemText">
                                                    <div className="dashItemTitle">{title}</div>
                                                    <div className="dashItemSubtitle">{address}</div>
                                                </div>
                                                {b.pay_method === "money" && (
                                                    <div className="dashItemPrice">£{toMoney(b.total_price_gbp).toFixed(2)}</div>
                                                )}
                                            </div>
                                            <div className="dashMetaRow">
                                                <span className="badge badge--warm">confirmed</span>
                                                <span className="badge">{b.pay_method}</span>
                                            </div>
                                            <div className="dashField">
                                                <div className="dashLabel">Time</div>
                                                <div className="tiny muted">{dt(b.start_time)} → {dt(b.end_time)}</div>
                                            </div>
                                            <div className="rowInline" style={{ marginTop: 8 }}>
                                                <Link to={`/spots/${b.parking_spot_id}`} className="btn">
                                                    View spot
                                                </Link>
                                            </div>
                                        </div>
                                    );
                                })}
                        </div>
                    ))}
                </div>
            </div>

            <div className="dashGrid" style={{ marginTop: 14 }}>
                <div className="card formSection">
                    <button
                        type="button"
                        className="sectionHeader sectionHeader--driver collapsibleHeader"
                        onClick={() => setOpen((p) => ({ ...p, myAuctionBids: !p.myAuctionBids }))}
                    >
                        <div className="sectionHeaderTitle">
                            <span className="sectionDot" />
                            <div className="h3">My pending bids</div>
                        </div>
                        <span className="badge badge--cool sectionHeaderBadge">Pending {myAuctionBids.length}</span>
                    </button>
                    <div className="sectionSub muted">
                        Pending, awaiting owner approval.
                    </div>

                    {open.myAuctionBids && (myAuctionBids.length === 0 ? (
                        <div className="muted">No pending bids.</div>
                    ) : (
                        <div className="stack">
                            {myAuctionBids.map((b) => {
                                const title = b.spot_title ?? "Auction listing";
                                return (
                                    <div key={b.id} className="card dashItem dashItem--driver">
                                        <div className="dashItemHeader">
                                            {renderThumb(undefined, title)}
                                            <div className="dashItemText">
                                                <div className="dashItemTitle">{title}</div>
                                                <div className="dashItemSubtitle">Pending owner approval</div>
                                            </div>
                                            <div className="dashItemPrice">£{toMoney(b.amount_gbp).toFixed(2)}</div>
                                        </div>
                                        <div className="dashMetaRow">
                                            <span className="badge">{b.status}</span>
                                            <span className="badge">Auction bid</span>
                                        </div>
                                        {(b.start_time && b.end_time) && (
                                            <div className="dashField">
                                                <div className="dashLabel">Time</div>
                                                <div className="tiny muted">{dt(b.start_time)} → {dt(b.end_time)}</div>
                                            </div>
                                        )}
                                        <div className="rowInline" style={{ marginTop: 8 }}>
                                            <Link to={`/spots/${b.parking_spot_id}`} className="btn">
                                                View listing
                                            </Link>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>

                <div className="card formSection">
                    <button
                        type="button"
                        className="sectionHeader sectionHeader--owner collapsibleHeader"
                        onClick={() => setOpen((p) => ({ ...p, ownerPending: !p.ownerPending }))}
                    >
                        <div className="sectionHeaderTitle">
                            <span className="sectionDot" />
                            <div className="h3">Pending bids - awaiting approval</div>
                        </div>
                        <span className="badge badge--warm sectionHeaderBadge">
                            {pendingOwnerCount} pending
                        </span>
                    </button>
                    <div className="sectionSub muted">
                        Review bids and choose the winner. Charges are captured on approval.
                    </div>

                    {open.ownerPending && (
                        <div className="stack" style={{ marginTop: 10 }}>
                            <div className="tiny muted">Auction bids</div>
                            {auctionBids.filter((b) => {
                                const s = String(b.status ?? "").toLowerCase();
                                return s === "pending";
                            }).length === 0 ? (
                                <div className="muted">No bids yet.</div>
                            ) : (
                                auctionBids
                                    .filter((b) => {
                                        const s = String(b.status ?? "").toLowerCase();
                                        return s === "pending";
                                    })
                                    .map((b) => {
                                        const title = b.spot_title ?? "Auction listing";
                                        return (
                                            <div key={b.id} className="card dashItem dashItem--owner">
                                                <div className="dashItemHeader">
                                                    {renderThumb(undefined, title)}
                                                    <div className="dashItemText">
                                                        <div className="dashItemTitle">{title}</div>
                                                        <div className="dashItemSubtitle">{b.bidder_name ?? b.bidder_email ?? "Bidder"}</div>
                                                    </div>
                                                    <div className="dashItemPrice">£{toMoney(b.amount_gbp).toFixed(2)}</div>
                                                </div>
                                                <div className="dashMetaRow">
                                                    <span className="badge">{b.status}</span>
                                                    <span className="badge">Auction bid</span>
                                                </div>
                                                {(b.start_time && b.end_time) && (
                                                    <div className="dashField">
                                                        <div className="dashLabel">Time</div>
                                                        <div className="tiny muted">{dt(b.start_time)} → {dt(b.end_time)}</div>
                                                    </div>
                                                )}
                                                <div className="rowInline" style={{ marginTop: 8 }}>
                                                    <button
                                                        onClick={() => acceptBid(b.parking_spot_id, b.id)}
                                                        disabled={busyId === b.id}
                                                        className="btn btn-primary"
                                                    >
                                                        Accept
                                                    </button>
                                                    <button
                                                        onClick={() => rejectBid(b.parking_spot_id, b.id)}
                                                        disabled={busyId === b.id}
                                                        className="btn"
                                                    >
                                                        Reject
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })
                            )}
                        </div>
                    )}
                </div>
            </div>

            <div className="dashGrid" style={{ marginTop: 14 }}>
                <div className="card formSection">
                    <button
                        type="button"
                        className="sectionHeader sectionHeader--rewards collapsibleHeader"
                        onClick={() => setOpen((p) => ({ ...p, rewards: !p.rewards }))}
                    >
                        <div className="sectionHeaderTitle">
                            <span className="sectionDot" />
                            <div className="h3">My rewards</div>
                        </div>
                        <span className="badge badge--accent sectionHeaderBadge">Points</span>
                    </button>
                    <div className="sectionSub muted">
                        Points earned and spent across the platform.
                    </div>

                    {open.rewards && (rewards.length === 0 ? (
                        <div className="muted">No reward activity yet.</div>
                    ) : (
                        <div className="stack">
                            {rewards
                                .slice()
                                .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
                                .map((r) => (
                                    <div key={r.id} className="card dashItem dashItem--rewards">
                                        <div className="dashItemHeader">
                                            {renderThumb(undefined, r.reason)}
                                            <div className="dashItemText">
                                                <div className="dashItemTitle">{r.reason}</div>
                                                <div className="dashItemSubtitle">{r.type.toUpperCase()} points</div>
                                            </div>
                                            <div className="dashItemPrice">{r.amount} pts</div>
                                        </div>
                                        <div className="dashMetaRow">
                                            <span className="badge">{r.type.toUpperCase()}</span>
                                            <span className="badge badge--accent">Rewards</span>
                                        </div>
                                        <div className="dashField">
                                            <div className="dashLabel">Date</div>
                                            <div className="tiny muted">{dt(r.created_at)}</div>
                                        </div>
                                    </div>
                                ))}
                        </div>
                    ))}
                </div>

                <div className="card formSection">
                    <button
                        type="button"
                        className="sectionHeader sectionHeader--payments collapsibleHeader"
                        onClick={() => setOpen((p) => ({ ...p, payments: !p.payments }))}
                    >
                        <div className="sectionHeaderTitle">
                            <span className="sectionDot" />
                            <div className="h3">Payments</div>
                        </div>
                        <span className="badge badge--rose sectionHeaderBadge">History</span>
                    </button>
                    <div className="sectionSub muted">
                        Money transactions for your bookings.
                    </div>

                    {open.payments && (payments.length === 0 ? (
                        <div className="muted">No payments yet.</div>
                    ) : (
                        <div className="stack">
                            {payments.map((p) => {
                                const spot = p.spot_title ? spotByTitle.get(p.spot_title) : undefined;
                                const title = p.spot_title || "Parking spot";
                                return (
                                    <div key={p.id} className="card dashItem dashItem--payments">
                                        <div className="dashItemHeader">
                                            {renderThumb(spot?.image_url, title)}
                                            <div className="dashItemText">
                                                <div className="dashItemTitle">{title}</div>
                                                <div className="dashItemSubtitle">{p.spot_address}</div>
                                            </div>
                                            <div className="dashItemPrice">£{toMoney(p.amount_gbp).toFixed(2)}</div>
                                        </div>
                                        <div className="dashMetaRow">
                                            <span className="badge">{p.status}</span>
                                            <span className="badge">{p.provider}</span>
                                            <span className="badge badge--rose">Payment</span>
                                        </div>
                                        <div className="dashField">
                                            <div className="dashLabel">Booking window</div>
                                            <div className="tiny muted">{dt(p.start_time)} → {dt(p.end_time)}</div>
                                        </div>
                                        <div className="dashField">
                                            <div className="dashLabel">Paid at</div>
                                            <div className="tiny muted">{dt(p.created_at)}</div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>

            {/* Owner-side bookings now use /bookings/owner */}
        </div>
    );
}
