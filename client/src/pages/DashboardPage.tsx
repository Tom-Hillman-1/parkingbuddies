import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { apiGet, apiPatch, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";

type Me = {
    id: string;
    email: string;
    name: string;
    points_balance: number;
    stripe_account_id?: string | null;
    stripe_charges_enabled?: boolean;
    stripe_payouts_enabled?: boolean;
    stripe_details_submitted?: boolean;
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
    direction?: "incoming" | "outgoing";
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
    amount_points?: number | null;
    pay_method?: "money" | "points";
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
    amount_points?: number | null;
    pay_method?: "money" | "points";
    status: string;
    created_at: string;
    start_time?: string;
    end_time?: string;
    spot_title?: string;
};

type ConnectStatus = {
    account_id: string | null;
    charges_enabled: boolean;
    payouts_enabled: boolean;
    details_submitted: boolean;
    onboarding_complete: boolean;
    dashboard_enabled: boolean;
    demo_bypass: boolean;
    demo_available: boolean;
};

function toMoney(x: any) {
    const n = Number(x ?? 0);
    return Number.isFinite(n) ? n : 0;
}

function formatModeLabel(mode: string) {
    if (!mode) return "Unknown";
    return mode.charAt(0).toUpperCase() + mode.slice(1);
}

function dt(s: string) {
    // simple readable local time
    try {
        return new Date(s).toLocaleString();
    } catch {
        return s;
    }
}

function shortAddress(raw: string | null | undefined, maxLen = 46) {
    const address = String(raw ?? "").trim();
    if (!address) return "Address on file";

    const parts = address
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
    if (parts.length >= 2) {
        const compact = `${parts[0]}, ${parts[1]}`;
        if (compact.length <= maxLen) return compact;
    }

    if (address.length <= maxLen) return address;
    return `${address.slice(0, Math.max(0, maxLen - 3)).trimEnd()}...`;
}

function bookingStatusView(status?: string) {
    const s = String(status ?? "").toLowerCase();
    if (s === "pending") {
        return {
            label: "Pending",
            badgeClass: "badge badge--warm",
            itemClass: "dashItem--status-pending",
            rank: 0,
        };
    }
    if (s === "confirmed" || s === "approved" || s === "accepted") {
        return {
            label: "Approved",
            badgeClass: "badge badge--green",
            itemClass: "dashItem--status-approved",
            rank: 1,
        };
    }
    if (s === "cancelled" || s === "rejected" || s === "declined") {
        return {
            label: "Rejected",
            badgeClass: "badge badge--rose",
            itemClass: "dashItem--status-rejected",
            rank: 2,
        };
    }
    return {
        label: formatModeLabel(s || "unknown"),
        badgeClass: "badge",
        itemClass: "",
        rank: 3,
    };
}

function moneyFlowView(direction?: string) {
    if (direction === "incoming") {
        return {
            label: "Earned / Incoming",
            badgeClass: "badge badge--green",
            amountClass: "dashAmount dashAmount--incoming",
            sign: "+",
            cardClass: "dashItem--money-incoming",
        };
    }
    return {
        label: "Spent / Outgoing",
        badgeClass: "badge badge--rose",
        amountClass: "dashAmount dashAmount--outgoing",
        sign: "-",
        cardClass: "dashItem--money-outgoing",
    };
}

const DEFAULT_SEEN_COUNTS = {
    myBookings: 0,
    myAuctionBids: 0,
    driverUpcoming: 0,
    myListings: 0,
    ownerConfirmed: 0,
    ownerUpcoming: 0,
    ownerPending: 0,
    rewards: 0,
    payments: 0,
    payouts: 0,
};

export default function DashboardPage() {
    const { token } = useAuth();
    const [searchParams] = useSearchParams();

    const [me, setMe] = useState<Me | null>(null);
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [ownerBookings, setOwnerBookings] = useState<Booking[]>([]);
    const [spots, setSpots] = useState<ParkingSpot[]>([]);
    const [rewards, setRewards] = useState<RewardTx[]>([]);
    const [payments, setPayments] = useState<Payment[]>([]);
    const [auctionBids, setAuctionBids] = useState<AuctionBid[]>([]);
    const [myAuctionBids, setMyAuctionBids] = useState<MyAuctionBid[]>([]);
    const [connect, setConnect] = useState<ConnectStatus | null>(null);

    const [loading, setLoading] = useState(true);
    const [msg, setMsg] = useState<string | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [connectBusy, setConnectBusy] = useState(false);
    const [seenCounts, setSeenCounts] = useState(DEFAULT_SEEN_COUNTS);
    const [seenHydrated, setSeenHydrated] = useState(false);
    const [open, setOpen] = useState({
        manageBookings: false,
        manageListings: false,
        transactions: false,
        ownerConfirmed: false,
        ownerPending: false,
        payouts: false,
        myBookings: false,
        myListings: false,
        myAuctionBids: false,
        driverUpcoming: false,
        ownerUpcoming: false,
        payments: false,
        rewards: false,
    });

    const isLoggedIn = !!token;
    const seenCountsStorageKey = useMemo(
        () => (token ? `parkingbuddies.dashboard.seen-counts.v2.${token}` : null),
        [token]
    );

    useEffect(() => {
        setSeenHydrated(false);
        if (!seenCountsStorageKey) {
            setSeenCounts(DEFAULT_SEEN_COUNTS);
            setSeenHydrated(true);
            return;
        }
        try {
            const raw = window.localStorage.getItem(seenCountsStorageKey);
            if (!raw) {
                setSeenCounts(DEFAULT_SEEN_COUNTS);
                setSeenHydrated(true);
                return;
            }
            const parsed = JSON.parse(raw) as Partial<typeof DEFAULT_SEEN_COUNTS>;
            setSeenCounts({
                ...DEFAULT_SEEN_COUNTS,
                ...parsed,
            });
        } catch {
            setSeenCounts(DEFAULT_SEEN_COUNTS);
        } finally {
            setSeenHydrated(true);
        }
    }, [seenCountsStorageKey]);

    useEffect(() => {
        if (!seenCountsStorageKey || !seenHydrated) return;
        try {
            window.localStorage.setItem(seenCountsStorageKey, JSON.stringify(seenCounts));
        } catch {
            // no-op if storage is unavailable
        }
    }, [seenCounts, seenCountsStorageKey, seenHydrated]);

    function markSectionSeen(section: "manageBookings" | "manageListings" | "transactions") {
        setSeenCounts((p) => {
            if (section === "manageBookings") {
                return {
                    ...p,
                    myBookings: Math.max(p.myBookings, myBookings.length),
                    myAuctionBids: Math.max(p.myAuctionBids, myAuctionBids.length),
                    driverUpcoming: Math.max(p.driverUpcoming, driverUpcoming.length),
                };
            }
            if (section === "manageListings") {
                return {
                    ...p,
                    myListings: Math.max(p.myListings, myListings.length),
                    ownerConfirmed: Math.max(p.ownerConfirmed, confirmedOwnerBookings.length),
                    ownerUpcoming: Math.max(p.ownerUpcoming, ownerUpcoming.length),
                    ownerPending: Math.max(p.ownerPending, pendingOwnerCount),
                };
            }
            return {
                ...p,
                rewards: Math.max(p.rewards, rewards.length),
                payments: Math.max(p.payments, payments.length),
                payouts: Math.max(p.payouts, payoutsSignal),
            };
        });
    }

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
            try {
                const connectRes = await apiGet<{ connect: ConnectStatus }>("/payments/connect/status", token);
                setConnect(connectRes.connect ?? null);
            } catch {
                setConnect(null);
            }
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
            manageBookings: tab === "myBookings" || tab === "myAuctionBids" || tab === "driverUpcoming" ? true : p.manageBookings,
            manageListings: tab === "myListings" || tab === "ownerConfirmed" || tab === "ownerPending" || tab === "ownerUpcoming" ? true : p.manageListings,
            transactions: tab === "rewards" || tab === "payments" || tab === "payouts" ? true : p.transactions,
            myBookings: tab === "myBookings" ? true : p.myBookings,
            myAuctionBids: tab === "myAuctionBids" ? true : p.myAuctionBids,
            ownerPending: tab === "ownerPending" ? true : p.ownerPending,
            ownerConfirmed: tab === "ownerConfirmed" ? true : p.ownerConfirmed,
            driverUpcoming: tab === "driverUpcoming" ? true : p.driverUpcoming,
            ownerUpcoming: tab === "ownerUpcoming" ? true : p.ownerUpcoming,
            payouts: tab === "payouts" ? true : p.payouts,
            myListings: tab === "myListings" ? true : p.myListings,
            rewards: tab === "rewards" ? true : p.rewards,
            payments: tab === "payments" ? true : p.payments,
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
    const hasPendingOwnerActions = pendingOwnerCount > 0;

    const confirmedOwnerBookings = useMemo(() => {
        return ownerBookings.filter((b) => b.status === "confirmed");
    }, [ownerBookings]);

    const connectLabel = connect?.demo_bypass
        ? "Demo mode active"
        : !connect?.account_id
            ? "Not connected"
            : connect.onboarding_complete
                ? "Ready for payouts"
                : "Onboarding incomplete";
    const connectBadgeClass = connect?.demo_bypass
        ? "badge badge--cool"
        : !connect?.account_id
            ? "badge badge--rose"
            : connect.onboarding_complete
                ? "badge badge--green"
                : "badge badge--warm";

    const driverUpcoming = useMemo(() => {
        const now = Date.now();
        return myBookings
            .filter((b) => new Date(b.start_time).getTime() >= now)
            .filter((b) => b.status !== "cancelled")
            .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
            .slice(0, 8);
    }, [myBookings]);

    const ownerUpcoming = useMemo(() => {
        const now = Date.now();
        return ownerBookings
            .filter((b) => new Date(b.start_time).getTime() >= now && b.status === "confirmed")
            .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
            .slice(0, 8);
    }, [ownerBookings]);

    const payoutsSignal = useMemo(() => {
        if (!connect) return 0;
        let score = 0;
        if (connect.account_id) score += 1;
        if (connect.onboarding_complete) score += 1;
        if (connect.payouts_enabled) score += 1;
        return score;
    }, [connect]);

    useEffect(() => {
        if (!open.myBookings) return;
        setSeenCounts((p) => ({ ...p, myBookings: Math.max(p.myBookings, myBookings.length) }));
    }, [open.myBookings, myBookings.length]);

    useEffect(() => {
        if (!open.myAuctionBids) return;
        setSeenCounts((p) => ({ ...p, myAuctionBids: Math.max(p.myAuctionBids, myAuctionBids.length) }));
    }, [open.myAuctionBids, myAuctionBids.length]);

    useEffect(() => {
        if (!open.driverUpcoming) return;
        setSeenCounts((p) => ({ ...p, driverUpcoming: Math.max(p.driverUpcoming, driverUpcoming.length) }));
    }, [open.driverUpcoming, driverUpcoming.length]);

    useEffect(() => {
        if (!open.myListings) return;
        setSeenCounts((p) => ({ ...p, myListings: Math.max(p.myListings, myListings.length) }));
    }, [open.myListings, myListings.length]);

    useEffect(() => {
        if (!open.ownerConfirmed) return;
        setSeenCounts((p) => ({ ...p, ownerConfirmed: Math.max(p.ownerConfirmed, confirmedOwnerBookings.length) }));
    }, [open.ownerConfirmed, confirmedOwnerBookings.length]);

    useEffect(() => {
        if (!open.ownerUpcoming) return;
        setSeenCounts((p) => ({ ...p, ownerUpcoming: Math.max(p.ownerUpcoming, ownerUpcoming.length) }));
    }, [open.ownerUpcoming, ownerUpcoming.length]);

    useEffect(() => {
        if (!open.ownerPending) return;
        setSeenCounts((p) => ({ ...p, ownerPending: Math.max(p.ownerPending, pendingOwnerCount) }));
    }, [open.ownerPending, pendingOwnerCount]);

    useEffect(() => {
        if (!open.rewards) return;
        setSeenCounts((p) => ({ ...p, rewards: Math.max(p.rewards, rewards.length) }));
    }, [open.rewards, rewards.length]);

    useEffect(() => {
        if (!open.payments) return;
        setSeenCounts((p) => ({ ...p, payments: Math.max(p.payments, payments.length) }));
    }, [open.payments, payments.length]);

    useEffect(() => {
        if (!open.payouts) return;
        setSeenCounts((p) => ({ ...p, payouts: Math.max(p.payouts, payoutsSignal) }));
    }, [open.payouts, payoutsSignal]);

    const tabHasNew = {
        myBookings: myBookings.length > seenCounts.myBookings,
        myAuctionBids: myAuctionBids.length > seenCounts.myAuctionBids,
        driverUpcoming: driverUpcoming.length > seenCounts.driverUpcoming,
        myListings: myListings.length > seenCounts.myListings,
        ownerConfirmed: confirmedOwnerBookings.length > seenCounts.ownerConfirmed,
        ownerUpcoming: ownerUpcoming.length > seenCounts.ownerUpcoming,
        ownerPending: pendingOwnerCount > seenCounts.ownerPending,
        rewards: rewards.length > seenCounts.rewards,
        payments: payments.length > seenCounts.payments,
        payouts: payoutsSignal > seenCounts.payouts,
    };

    const sectionHasNew = {
        manageBookings: tabHasNew.myBookings || tabHasNew.myAuctionBids || tabHasNew.driverUpcoming,
        manageListings: tabHasNew.myListings || tabHasNew.ownerConfirmed || tabHasNew.ownerUpcoming || tabHasNew.ownerPending,
        transactions: tabHasNew.rewards || tabHasNew.payments || tabHasNew.payouts,
    };

    async function cancelBooking(id: string) {
        if (!token) return;
        setBusyId(id);
        setMsg(null);
        setErr(null);

        try {
            await apiPatch<{ booking: Booking }>(`/bookings/${id}/cancel`, {}, token);
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

    async function refreshConnectStatus() {
        if (!token) return;
        try {
            const r = await apiGet<{ connect: ConnectStatus }>("/payments/connect/status", token);
            setConnect(r.connect ?? null);
        } catch (e: any) {
            setErr(e?.message || "Failed to refresh Stripe status");
        }
    }

    async function beginConnectOnboarding(mode: "stripe" | "demo" = "stripe") {
        if (!token) return;
        setConnectBusy(true);
        setErr(null);
        try {
            const r = await apiPost<{ url?: string; connect: ConnectStatus }>(
                "/payments/connect/onboard",
                { mode },
                token
            );
            setConnect(r.connect ?? null);
            if (r.connect?.demo_bypass) {
                setMsg("Demo payout mode is enabled. Stripe onboarding is skipped.");
                return;
            }
            if (r.url) {
                window.location.href = r.url;
            } else {
                setErr("Stripe onboarding link was missing.");
            }
        } catch (e: any) {
            setErr(e?.message || "Unable to start Stripe onboarding");
        } finally {
            setConnectBusy(false);
        }
    }

    async function openConnectDashboard() {
        if (!token) return;
        setConnectBusy(true);
        setErr(null);
        try {
            const r = await apiPost<{ url: string; connect: ConnectStatus }>("/payments/connect/dashboard-link", {}, token);
            setConnect(r.connect ?? null);
            window.open(r.url, "_blank", "noopener,noreferrer");
        } catch (e: any) {
            setErr(e?.message || "Unable to open Stripe dashboard");
        } finally {
            setConnectBusy(false);
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
                        Total earned (incoming): +£{ownerBookings
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

            <div className="card formSection dashboardGroup dashboardGroup--bookings">
                <button
                    type="button"
                    className="sectionHeader sectionHeader--driver collapsibleHeader dashboardGroupHeader"
                    onClick={() => {
                        const nextOpen = !open.manageBookings;
                        if (nextOpen) markSectionSeen("manageBookings");
                        setOpen((p) => ({ ...p, manageBookings: nextOpen }));
                    }}
                >
                    <div className="sectionHeaderTitle">
                        <span className="sectionDot" />
                        <div>
                            <div className="heroKicker">MANAGE MY BOOKINGS</div>
                            <div className="h2">Driver activity</div>
                        </div>
                    </div>
                    <span className={`badge badge--cool sectionHeaderBadge${sectionHasNew.manageBookings ? " badge--notify" : ""}`}>
                        {myBookings.length + myAuctionBids.length + driverUpcoming.length} items
                    </span>
                </button>
                <div className="sectionSub muted">My bookings, my pending bids, and upcoming schedule as a driver.</div>
                {open.manageBookings && (
                    <div className="dashGrid dashGrid--withinGroup" style={{ marginTop: 8 }}>
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
                                    const address = shortAddress(spot?.address_text);
                                    const statusView = bookingStatusView(b.status);
                                    const amountLabel = b.pay_method === "money"
                                        ? `-£${price.toFixed(2)}`
                                        : `-${b.total_points ?? 0} pts`;
                                    return (
                                        <div key={b.id} className="card dashItem dashItem--driver">
                                            <div className="dashItemHeader">
                                                {renderThumb(spot?.image_url, title)}
                                                <div className="dashItemText">
                                                    <div className="dashItemTitle">{title}</div>
                                                    <div className="dashItemSubtitle">{address}</div>
                                                </div>
                                                <div className="dashItemPrice dashAmount dashAmount--outgoing">
                                                    {amountLabel}
                                                </div>
                                            </div>
                                            <div className="dashMetaRow">
                                                <span className={statusView.badgeClass}>{statusView.label}</span>
                                                <span className="badge">{formatModeLabel(b.pay_method)}</span>
                                                <span className="badge badge--cool">Other listing</span>
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
                                                    Show receipt
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
                        Pending bids waiting for owner approval.
                    </div>

                    {open.myAuctionBids && (myAuctionBids.length === 0 ? (
                        <div className="muted">No pending bids.</div>
                    ) : (
                        <div className="stack">
                            {myAuctionBids
                                .slice()
                                .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
                                .map((b) => {
                                    const title = b.spot_title ?? "Auction listing";
                                    const isPoints = (b.pay_method ?? "money") === "points";
                                    return (
                                        <div key={b.id} className="card dashItem dashItem--driver">
                                            <div className="dashItemHeader">
                                                {renderThumb(undefined, title)}
                                                <div className="dashItemText">
                                                    <div className="dashItemTitle">{title}</div>
                                                    <div className="dashItemSubtitle">Pending owner approval</div>
                                                </div>
                                                <div className="dashItemPrice">
                                                    {isPoints ? `${b.amount_points ?? 0} pts` : `£${toMoney(b.amount_gbp).toFixed(2)}`}
                                                </div>
                                            </div>
                                            <div className="dashMetaRow">
                                                <span className="badge">{b.status}</span>
                                                <span className="badge">Auction Bid</span>
                                                <span className="badge">{isPoints ? "Points" : "Money"}</span>
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
                        className="sectionHeader sectionHeader--driver collapsibleHeader"
                        onClick={() => setOpen((p) => ({ ...p, driverUpcoming: !p.driverUpcoming }))}
                    >
                        <div className="sectionHeaderTitle">
                            <span className="sectionDot" />
                            <div className="h3">My upcoming schedule as a driver</div>
                        </div>
                        <span className="badge badge--cool sectionHeaderBadge">{driverUpcoming.length} upcoming</span>
                    </button>
                    <div className="sectionSub muted">
                        Upcoming time slots you booked from other owners.
                    </div>

                    {open.driverUpcoming && (driverUpcoming.length === 0 ? (
                        <div className="muted">No upcoming driver bookings.</div>
                    ) : (
                        <div className="stack">
                            {driverUpcoming.map((b) => {
                                const spot = spotById.get(b.parking_spot_id);
                                const title = spot?.title ?? "Parking spot";
                                const address = shortAddress(spot?.address_text);
                                const isPoints = b.pay_method === "points";
                                const statusView = bookingStatusView(b.status);
                                return (
                                    <div key={b.id} className={`card dashItem dashItem--driver ${statusView.itemClass}`}>
                                        <div className="dashItemHeader">
                                            {renderThumb(spot?.image_url, title)}
                                            <div className="dashItemText">
                                                <div className="dashItemTitle">{title}</div>
                                                <div className="dashItemSubtitle">{address}</div>
                                            </div>
                                            <div className="dashItemPrice dashAmount dashAmount--outgoing">
                                                {isPoints
                                                    ? `-${b.total_points ?? 0} pts`
                                                    : `-£${toMoney(b.total_price_gbp).toFixed(2)}`}
                                            </div>
                                        </div>
                                        <div className="dashMetaRow">
                                            <span className={statusView.badgeClass}>{statusView.label}</span>
                                            <span className="badge">{isPoints ? "Points" : "Money"}</span>
                                            <span className="badge badge--cool">Driver booking</span>
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
                )}
            </div>

            <div className="card formSection dashboardGroup dashboardGroup--listings" style={{ marginTop: 14 }}>
                <button
                    type="button"
                    className="sectionHeader sectionHeader--owner collapsibleHeader dashboardGroupHeader"
                    onClick={() => {
                        const nextOpen = !open.manageListings;
                        if (nextOpen) markSectionSeen("manageListings");
                        setOpen((p) => ({ ...p, manageListings: nextOpen }));
                    }}
                >
                    <div className="sectionHeaderTitle">
                        <span className="sectionDot" />
                        <div>
                            <div className="heroKicker">MANAGE MY LISTINGS</div>
                            <div className="h2">Owner activity</div>
                        </div>
                    </div>
                    <span
                        className={`badge badge--warm sectionHeaderBadge${sectionHasNew.manageListings ? " badge--notify" : ""}${hasPendingOwnerActions ? " badge--action-count" : ""}`}
                    >
                        {hasPendingOwnerActions
                            ? `+${pendingOwnerCount}`
                            : `${myListings.length + confirmedOwnerBookings.length + ownerUpcoming.length + pendingOwnerCount} items`}
                    </span>
                </button>
                <div className="sectionSub muted">My listings, booked slots, owner schedule, and bids awaiting approval.</div>
                {open.manageListings && (
                    <div className="dashGrid dashGrid--withinGroup" style={{ marginTop: 14 }}>
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
                                const auctionStart = Number(s.auction_start_price_gbp ?? 0);
                                const priceLabel = s.mode === "auction"
                                    ? `Min bid £${auctionStart.toFixed(2)}`
                                    : price > 0 ? `£${price.toFixed(2)}` : "Free";
                                return (
                                    <div key={s.id} className="card dashItem dashItem--listings">
                                        <div className="dashItemHeader">
                                            {renderThumb(s.image_url, s.title)}
                                            <div className="dashItemText">
                                                <div className="dashItemTitle">{s.title}</div>
                                                <div className="dashItemSubtitle">{shortAddress(s.address_text)}</div>
                                            </div>
                                            <div className="dashItemPrice">
                                                {priceLabel}
                                            </div>
                                        </div>
                                        <div className="dashMetaRow">
                                            <span className="badge badge--green">My listing</span>
                                            <span className="badge">{formatModeLabel(s.mode)}</span>
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
                <div className="card formSection">
                    <button
                        type="button"
                        className="sectionHeader sectionHeader--owner collapsibleHeader"
                        onClick={() => setOpen((p) => ({ ...p, ownerConfirmed: !p.ownerConfirmed }))}
                    >
                        <div className="sectionHeaderTitle">
                            <span className="sectionDot" />
                            <div className="h3">Booked slots on my listings</div>
                        </div>
                        <span className="badge badge--warm sectionHeaderBadge">
                            {confirmedOwnerBookings.length} bookings confirmed
                        </span>
                    </button>
                    <div className="sectionSub muted">
                        Confirmed bookings made by other users on your spaces.
                    </div>

                    {open.ownerConfirmed && (confirmedOwnerBookings.length === 0 ? (
                        <div className="muted">No confirmed bookings yet.</div>
                    ) : (
                        <div className="stack">
                            {confirmedOwnerBookings.map((b) => {
                                    const spot = spotById.get(b.parking_spot_id);
                                    const title = spot?.title ?? "Parking spot";
                                    const address = shortAddress(spot?.address_text);
                                    return (
                                        <div key={b.id} className="card dashItem dashItem--owner">
                                            <div className="dashItemHeader">
                                                {renderThumb(spot?.image_url, title)}
                                                <div className="dashItemText">
                                                    <div className="dashItemTitle">{title}</div>
                                                    <div className="dashItemSubtitle">{address}</div>
                                                </div>
                                                {b.pay_method === "money" && (
                                                    <div className="dashItemPrice dashAmount dashAmount--incoming">+£{toMoney(b.total_price_gbp).toFixed(2)}</div>
                                                )}
                                            </div>
                                            <div className="dashMetaRow">
                                                <span className="badge badge--green">Earned / Incoming</span>
                                                <span className="badge badge--green">My listing</span>
                                                <span className="badge badge--warm">Confirmed</span>
                                                <span className="badge">{formatModeLabel(b.pay_method)}</span>
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
                        onClick={() => setOpen((p) => ({ ...p, ownerUpcoming: !p.ownerUpcoming }))}
                    >
                        <div className="sectionHeaderTitle">
                            <span className="sectionDot" />
                            <div className="h3">My upcoming schedule as an owner</div>
                        </div>
                        <span className="badge badge--warm sectionHeaderBadge">{ownerUpcoming.length} upcoming</span>
                    </button>
                    <div className="sectionSub muted">
                        Upcoming confirmed bookings on your own listings.
                    </div>

                    {open.ownerUpcoming && (ownerUpcoming.length === 0 ? (
                        <div className="muted">No upcoming owner bookings.</div>
                    ) : (
                        <div className="stack">
                            {ownerUpcoming.map((b) => {
                                const spot = spotById.get(b.parking_spot_id);
                                const title = spot?.title ?? "Parking spot";
                                const address = shortAddress(spot?.address_text);
                                const isPoints = b.pay_method === "points";
                                return (
                                    <div key={b.id} className="card dashItem dashItem--owner">
                                        <div className="dashItemHeader">
                                            {renderThumb(spot?.image_url, title)}
                                            <div className="dashItemText">
                                                <div className="dashItemTitle">{title}</div>
                                                <div className="dashItemSubtitle">{address}</div>
                                            </div>
                                            <div className="dashItemPrice dashAmount dashAmount--incoming">
                                                {isPoints ? `+${b.total_points ?? 0} pts` : `+£${toMoney(b.total_price_gbp).toFixed(2)}`}
                                            </div>
                                        </div>
                                        <div className="dashMetaRow">
                                            <span className="badge badge--green">Earned / Incoming</span>
                                            <span className="badge badge--green">Owner schedule</span>
                                            <span className="badge">{isPoints ? "Points" : "Money"}</span>
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
                        onClick={() => setOpen((p) => ({ ...p, ownerPending: !p.ownerPending }))}
                    >
                        <div className="sectionHeaderTitle">
                            <span className="sectionDot" />
                            <div className="h3">Pending bids - awaiting approval</div>
                        </div>
                        <span className="badge badge--warm sectionHeaderBadge">{pendingOwnerCount} pending</span>
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
                                        const isPoints = (b.pay_method ?? "money") === "points";
                                        return (
                                            <div key={b.id} className="card dashItem dashItem--owner">
                                                <div className="dashItemHeader">
                                                    {renderThumb(undefined, title)}
                                                    <div className="dashItemText">
                                                        <div className="dashItemTitle">{title}</div>
                                                        <div className="dashItemSubtitle">{b.bidder_name ?? b.bidder_email ?? "Bidder"}</div>
                                                    </div>
                                                    <div className="dashItemPrice">
                                                        {isPoints ? `${b.amount_points ?? 0} pts` : `£${toMoney(b.amount_gbp).toFixed(2)}`}
                                                    </div>
                                                </div>
                                                <div className="dashMetaRow">
                                                    <span className="badge">{b.status}</span>
                                                    <span className="badge">Auction Bid</span>
                                                    <span className="badge">{isPoints ? "Points" : "Money"}</span>
                                                </div>
                                                <div className="ownerActionRequired">Action Required</div>
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
                )}
            </div>

            <div className="card formSection dashboardGroup dashboardGroup--transactions" style={{ marginTop: 14 }}>
                <button
                    type="button"
                    className="sectionHeader sectionHeader--payments collapsibleHeader dashboardGroupHeader"
                    onClick={() => {
                        const nextOpen = !open.transactions;
                        if (nextOpen) markSectionSeen("transactions");
                        setOpen((p) => ({ ...p, transactions: nextOpen }));
                    }}
                >
                    <div className="sectionHeaderTitle">
                        <span className="sectionDot" />
                        <div>
                            <div className="heroKicker">TRANSACTIONS</div>
                            <div className="h2">Payments and rewards</div>
                        </div>
                    </div>
                    <span className={`badge badge--rose sectionHeaderBadge${sectionHasNew.transactions ? " badge--notify" : ""}`}>{payments.length + rewards.length} records</span>
                </button>
                <div className="sectionSub muted">Stripe payouts, payment history, and rewards activity.</div>
                {open.transactions && (
                    <>
                        <div className="dashGrid dashGrid--withinGroup" style={{ marginTop: 14 }}>
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
                                            .map((r) => {
                                                const incoming = String(r.type ?? "").toLowerCase() === "earn";
                                                const flowLabel = incoming ? "Earned / Incoming" : "Spent / Outgoing";
                                                const amountPrefix = incoming ? "+" : "-";
                                                return (
                                                    <div
                                                        key={r.id}
                                                        className={`card dashItem dashItem--rewards ${incoming ? "dashItem--rewards-incoming" : "dashItem--rewards-outgoing"}`}
                                                    >
                                                        <div className="dashItemHeader">
                                                            {renderThumb(undefined, r.reason)}
                                                            <div className="dashItemText">
                                                                <div className="dashItemTitle">{r.reason}</div>
                                                                <div className="dashItemSubtitle">{flowLabel} points</div>
                                                            </div>
                                                            <div className={`dashItemPrice ${incoming ? "dashAmount dashAmount--incoming" : "dashAmount dashAmount--outgoing"}`}>
                                                                {amountPrefix}{r.amount} pts
                                                            </div>
                                                        </div>
                                                        <div className="dashMetaRow">
                                                            <span className={`badge ${incoming ? "badge--green" : "badge--rose"}`}>{flowLabel}</span>
                                                            <span className="badge badge--accent">Rewards</span>
                                                        </div>
                                                        <div className="dashField">
                                                            <div className="dashLabel">Date</div>
                                                            <div className="tiny muted">{dt(r.created_at)}</div>
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
                                    Money history across your bookings and your listings (outgoing and incoming).
                                </div>

                                {open.payments && (payments.length === 0 ? (
                                    <div className="muted">No payments yet.</div>
                                ) : (
                                    <div className="stack">
                                        {payments.map((p) => {
                                            const flow = moneyFlowView(p.direction);
                                            const spot = p.spot_title ? spotByTitle.get(p.spot_title) : undefined;
                                            const title = p.spot_title || "Parking spot";
                                            return (
                                                <div key={p.id} className={`card dashItem dashItem--payments ${flow.cardClass}`}>
                                                    <div className="dashItemHeader">
                                                        {renderThumb(spot?.image_url, title)}
                                                        <div className="dashItemText">
                                                            <div className="dashItemTitle">{title}</div>
                                                            <div className="dashItemSubtitle">{shortAddress(p.spot_address)}</div>
                                                        </div>
                                                        <div className={`dashItemPrice ${flow.amountClass}`}>
                                                            {flow.sign}£{toMoney(p.amount_gbp).toFixed(2)}
                                                        </div>
                                                    </div>
                                                    <div className="dashMetaRow">
                                                        <span className={flow.badgeClass}>{flow.label}</span>
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

                        <div className="dashGrid" style={{ marginTop: 14 }}>
                            <div className="card formSection">
                                <button
                                    type="button"
                                    className="sectionHeader sectionHeader--payments collapsibleHeader"
                                    onClick={() => setOpen((p) => ({ ...p, payouts: !p.payouts }))}
                                >
                                    <div className="sectionHeaderTitle">
                                        <span className="sectionDot" />
                                        <div className="h3">Stripe payouts</div>
                                    </div>
                                    <span className={`${connectBadgeClass} sectionHeaderBadge`}>{connectLabel}</span>
                                </button>
                                <div className="sectionSub muted">
                                    {connect?.demo_bypass
                                        ? "Demo bypass mode is active. Owner payouts are simulated and no Stripe onboarding is required."
                                        : "Connect Stripe to receive money from rent bookings and accepted auction bids."}
                                </div>

                                {open.payouts && (
                                    <div className="stack">
                                        <div className="settingRow">
                                            <div className="settingRowTitle">
                                                <div className="tiny muted">Connected account</div>
                                                <div className="spotInfoValue">
                                                    {connect?.demo_bypass
                                                        ? "Demo simulation (no connected Stripe account)"
                                                        : connect?.account_id ?? "Not connected"}
                                                </div>
                                            </div>
                                            <span className={connect?.charges_enabled ? "badge badge--green" : "badge badge--warm"}>
                                                {connect?.charges_enabled ? "Charges enabled" : "Charges pending"}
                                            </span>
                                        </div>
                                        <div className="settingRow">
                                            <div className="settingRowTitle">
                                                <div className="tiny muted">Payout capability</div>
                                                <div className="spotInfoValue">{connect?.payouts_enabled ? "Enabled" : "Pending"}</div>
                                            </div>
                                            <span className={connect?.details_submitted ? "badge badge--cool" : "badge badge--warm"}>
                                                {connect?.details_submitted ? "Details submitted" : "Details required"}
                                            </span>
                                        </div>
                                        <div className="rowInline">
                                            <button
                                                className="btn btn-primary"
                                                onClick={() => beginConnectOnboarding("stripe")}
                                                disabled={connectBusy}
                                            >
                                                {connectBusy
                                                    ? "Opening..."
                                                    : connect?.demo_bypass
                                                        ? "Connect Stripe instead"
                                                        : !connect?.account_id
                                                            ? "Connect Stripe"
                                                            : connect.onboarding_complete
                                                                ? "Update Stripe details"
                                                                : "Continue onboarding"}
                                            </button>
                                            {connect?.demo_available && !connect?.demo_bypass && !connect?.account_id && (
                                                <button className="btn" onClick={() => beginConnectOnboarding("demo")} disabled={connectBusy}>
                                                    Use demo payouts
                                                </button>
                                            )}
                                            <button className="btn" onClick={refreshConnectStatus} disabled={connectBusy}>
                                                Refresh status
                                            </button>
                                            <button
                                                className="btn"
                                                onClick={openConnectDashboard}
                                                disabled={connectBusy || !connect?.onboarding_complete || !!connect?.demo_bypass}
                                            >
                                                Open Stripe dashboard
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* Owner-side bookings now use /bookings/owner */}
        </div>
    );
}
