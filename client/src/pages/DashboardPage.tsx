
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { apiGet, apiPatch, apiPost } from "../lib/api";
import { useAuth, useStripeConnect } from "../lib/auth";
import { capitalizeLabel, formatDateTimeLocal, toFiniteNumber } from "./pagesShared";
import type { Booking as SharedBooking, ParkingSpot, RewardTransaction, User } from "../types";

type Me = User;
type Booking = SharedBooking & { owner_user_id: string; total_points: number | null; spot_mode?: "free" | "rent" | "auction" };
type RewardTx = RewardTransaction;
type DashboardSection = "manageBookings" | "manageListings" | "transactions";
type SectionTone = "driver" | "owner" | "rewards" | "payments";
type BadgeItem = { label: ReactNode; className?: string } | null | false | undefined;
type SectionCardKey =
    | "driverBookings"
    | "driverPendingBids"
    | "driverUpcoming"
    | "ownerListings"
    | "ownerConfirmed"
    | "ownerPending"
    | "ownerUpcoming"
    | "txRewards"
    | "txPayments"
    | "txStripe";
type AmountValue = number | string | null | undefined;
type Payment = { id: string; booking_id: string; provider: string; status: string; direction?: "incoming" | "outgoing"; amount_gbp: AmountValue; created_at: string; start_time: string; end_time: string; spot_title: string; spot_address: string };
type AuctionBid = { id: string; parking_spot_id: string; amount_gbp: AmountValue; amount_points?: number | null; pay_method?: "money" | "points"; status: string; created_at: string; start_time?: string; end_time?: string; bidder_name?: string; bidder_email?: string; spot_title?: string };

const POUND = String.fromCharCode(163);
const NAV_SECTIONS: Array<{ key: DashboardSection; title: string; subtitle: string; tone: "driver" | "owner" | "payments" }> = [
    { key: "manageBookings", title: "Manage bookings", subtitle: "Driver activity", tone: "driver" },
    { key: "manageListings", title: "Manage listings", subtitle: "Owner activity", tone: "owner" },
    { key: "transactions", title: "Transactions", subtitle: "Payments and rewards", tone: "payments" },
];

const shortAddress = (raw: string | null | undefined, maxLen = 46) => {
    const address = String(raw ?? "").trim();
    if (!address) return "Address on file";
    const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
        const compact = `${parts[0]}, ${parts[1]}`;
        if (compact.length <= maxLen) return compact;
    }
    return address.length <= maxLen ? address : `${address.slice(0, Math.max(0, maxLen - 3)).trimEnd()}...`;
};
const sortNewest = <T extends { created_at?: string }>(items: T[]) => [...items].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
const readErrorMessage = (error: unknown, fallback: string) =>
    error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string"
        ? (error as { message: string }).message
        : fallback;

function bookingStatusView(status?: string) {
    const value = String(status ?? "").toLowerCase();
    if (value === "pending") return { label: "Pending", badgeClass: "badge badge--warm" };
    if (value === "confirmed" || value === "approved" || value === "accepted") return { label: "Approved", badgeClass: "badge badge--green" };
    if (value === "cancelled" || value === "rejected" || value === "declined") return { label: "Rejected", badgeClass: "badge badge--rose" };
    return { label: capitalizeLabel(value || "unknown"), badgeClass: "badge" };
}

function moneyFlowView(direction?: string) {
    return direction === "incoming"
        ? { label: "Earned / Incoming", badgeClass: "badge badge--green", amountClass: "dashAmount dashAmount--incoming", sign: "+", cardClass: "dashItem--money-incoming" }
        : { label: "Spent / Outgoing", badgeClass: "badge badge--rose", amountClass: "dashAmount dashAmount--outgoing", sign: "-", cardClass: "dashItem--money-outgoing" };
}

const renderBadges = (items: BadgeItem[]) =>
    items
        .filter((item): item is { label: ReactNode; className?: string } => !!item && item.label != null)
        .map((item, idx) => (
            <span key={idx} className={item.className ?? "badge"}>
                {item.label}
            </span>
        ));

function TimeRow({ label = "Time", start, end, value }: { label?: string; start?: string | null; end?: string | null; value?: string }) {
    const text = value ?? (start && end ? `${formatDateTimeLocal(start)} -> ${formatDateTimeLocal(end)}` : "");
    return text ? (
        <div className="dashField">
            <div className="dashLabel">{label}</div>
            <div className="tiny muted">{text}</div>
        </div>
    ) : null;
}

function OwnerContactDetails({ email, phone, info }: { email?: string | null; phone?: string | null; info?: string | null }) {
    const contactEmail = String(email ?? "").trim();
    const contactPhone = String(phone ?? "").trim();
    const contactInfo = String(info ?? "").trim();
    if (!contactEmail && !contactPhone && !contactInfo) return null;
    return (
        <div className="dashField">
            <div className="dashLabel">Owner contact</div>
            {contactEmail && <div className="tiny muted">Email: {contactEmail}</div>}
            {contactPhone && <div className="tiny muted">Phone: {contactPhone}</div>}
            {contactInfo && <div className="tiny muted">{contactInfo}</div>}
        </div>
    );
}

function EmptyState({ text, linkTo, linkLabel }: { text: string; linkTo?: string; linkLabel?: string }) {
    return (
        <div className="muted">
            {text}
            {linkTo && linkLabel ? (
                <>
                    {" "}
                    <Link to={linkTo}>{linkLabel}</Link>.
                </>
            ) : null}
        </div>
    );
}

function SectionCard({
    title,
    subtitle,
    badge,
    tone,
    children,
    style,
    collapsed,
    onToggle,
}: {
    title: string;
    subtitle: string;
    badge?: ReactNode;
    tone: SectionTone;
    children: ReactNode;
    style?: React.CSSProperties;
    collapsed?: boolean;
    onToggle?: () => void;
}) {
    const isCollapsed = !!collapsed;
    return (
        <div className="card formSection" style={style}>
            <button type="button" className={`sectionHeader sectionHeader--${tone} collapsibleHeader`} onClick={onToggle} disabled={!onToggle}>
                <div className="sectionHeaderTitle">
                    <span className="sectionDot" />
                    <div className="h3">{title}</div>
                </div>
                {(badge || onToggle) && (
                    <span className="sectionHeaderBadge rowInline" style={{ gap: 8 }}>
                        {badge}
                        {onToggle && <span className="badge">{isCollapsed ? "Show" : "Hide"}</span>}
                    </span>
                )}
            </button>
            <div className="sectionSub muted">{subtitle}</div>
            {!isCollapsed && children}
        </div>
    );
}

function DashItemCard({ className, thumb, title, subtitle, amount, amountClassName, badges, fields, actions, footer }: { className?: string; thumb: ReactNode; title: ReactNode; subtitle?: ReactNode; amount?: ReactNode; amountClassName?: string; badges?: BadgeItem[]; fields?: ReactNode; actions?: ReactNode; footer?: ReactNode }) {
    return (
        <div className={`card dashItem ${className ?? ""}`.trim()}>
            <div className="dashItemHeader">
                {thumb}
                <div className="dashItemText">
                    <div className="dashItemTitle">{title}</div>
                    {subtitle ? <div className="dashItemSubtitle">{subtitle}</div> : null}
                </div>
                {amount !== undefined && amount !== null ? <div className={`dashItemPrice ${amountClassName ?? ""}`.trim()}>{amount}</div> : null}
            </div>
            {badges?.length ? <div className="dashMetaRow">{renderBadges(badges)}</div> : null}
            {fields}
            {actions ? <div className="rowInline" style={{ marginTop: 8 }}>{actions}</div> : null}
            {footer}
        </div>
    );
}

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
    const [myAuctionBids, setMyAuctionBids] = useState<AuctionBid[]>([]);

    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [msg, setMsg] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [receiptLoadingId, setReceiptLoadingId] = useState<string | null>(null);
    const [paymentReceiptErrors, setPaymentReceiptErrors] = useState<Record<string, string | null>>({});
    const {
        connect,
        connectBusy,
        refreshConnectStatus,
        beginConnectOnboarding,
        openConnectDashboard,
    } = useStripeConnect(token);
    const [activeSection, setActiveSection] = useState<DashboardSection>("manageBookings");
    const [collapsedSections, setCollapsedSections] = useState<Record<SectionCardKey, boolean>>({
        driverBookings: true,
        driverPendingBids: true,
        driverUpcoming: true,
        ownerListings: true,
        ownerConfirmed: true,
        ownerPending: true,
        ownerUpcoming: true,
        txRewards: true,
        txPayments: true,
        txStripe: true,
    });
    const payoutsRef = useRef<HTMLDivElement | null>(null);

    const toggleSection = (key: SectionCardKey) => {
        setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
    };

    const loadAll = useCallback(async () => {
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
                apiGet<{ bids: AuctionBid[] }>("/auctions/me/pending", token),
            ]);
            setMe(meRes.user);
            setBookings(bookingsRes.bookings ?? []);
            setOwnerBookings(ownerBookingsRes.bookings ?? []);
            setRewards(rewardsRes.rewards ?? []);
            setSpots(spotsRes.parking_spots ?? []);
            setPayments(paymentsRes.payments ?? []);
            setAuctionBids(bidsRes.bids ?? []);
            setMyAuctionBids(myBidsRes.bids ?? []);
            await refreshConnectStatus(true);
        } catch (error: unknown) {
            setErr(readErrorMessage(error, "Failed to load dashboard"));
        } finally {
            setLoading(false);
        }
    }, [token, refreshConnectStatus]);

    useEffect(() => {
        if (!token) return;
        void loadAll();
    }, [token, loadAll]);

    useEffect(() => {
        const tab = searchParams.get("tab");
        if (!tab) return;
        const tabToSection: Record<string, DashboardSection> = {
            myBookings: "manageBookings", myAuctionBids: "manageBookings", driverUpcoming: "manageBookings",
            myListings: "manageListings", ownerConfirmed: "manageListings", ownerPending: "manageListings", ownerUpcoming: "manageListings",
            rewards: "transactions", payments: "transactions", payouts: "transactions",
        };
        const section = tabToSection[tab];
        if (!section) return;
        setActiveSection(section);
        if (tab === "payouts") {
            expandAndScrollPayouts();
        }
    }, [searchParams]);

    const myListings = useMemo(() => (me ? spots.filter((spot) => spot.owner_user_id === me.id) : []), [spots, me]);
    const spotById = useMemo(() => new Map(spots.map((spot) => [spot.id, spot])), [spots]);
    const sortedMyBookings = useMemo(() => sortNewest(bookings), [bookings]);
    const sortedMyAuctionBids = useMemo(() => sortNewest(myAuctionBids), [myAuctionBids]);
    const sortedMyListings = useMemo(() => sortNewest(myListings), [myListings]);
    const sortedRewards = useMemo(() => sortNewest(rewards), [rewards]);
    const pendingOwnerBids = useMemo(() => auctionBids.filter((bid) => String(bid.status ?? "").toLowerCase() === "pending"), [auctionBids]);
    const confirmedOwnerBookings = useMemo(() => ownerBookings.filter((booking) => String(booking.status ?? "").toLowerCase() === "confirmed"), [ownerBookings]);

    const driverUpcoming = useMemo(() => {
        const now = Date.now();
        return bookings
            .filter((booking) => new Date(booking.start_time).getTime() >= now)
            .filter((booking) => String(booking.status ?? "").toLowerCase() !== "cancelled")
            .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
            .slice(0, 8);
    }, [bookings]);

    const ownerUpcoming = useMemo(() => {
        const now = Date.now();
        return ownerBookings
            .filter((booking) => new Date(booking.start_time).getTime() >= now)
            .filter((booking) => String(booking.status ?? "").toLowerCase() === "confirmed")
            .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
            .slice(0, 8);
    }, [ownerBookings]);

    const totalEarned = useMemo(
        () => ownerBookings.filter((booking) => booking.status === "confirmed" && booking.pay_method === "money").reduce((sum, booking) => sum + toFiniteNumber(booking.total_price_gbp), 0),
        [ownerBookings]
    );

    const connectLabel = connect?.demo_bypass ? "Demo mode active" : !connect?.account_id ? "Not connected" : connect.onboarding_complete ? "Stripe Connected" : "Onboarding incomplete";
    const connectBadgeClass = connect?.demo_bypass ? "badge badge--cool" : !connect?.account_id ? "badge badge--rose" : connect.onboarding_complete ? "badge badge--green" : "badge badge--warm";

    const headerStats = [
        { label: "My bookings", value: String(bookings.length) },
        { label: "Pending bids", value: String(pendingOwnerBids.length + myAuctionBids.length) },
        { label: "My listings", value: String(myListings.length) },
        { label: "Points", value: `${me?.points_balance ?? 0} pts` },
        { label: "Total earned", value: `${POUND}${totalEarned.toFixed(2)}` },
    ];
    const receiptDate = useMemo(() => new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date()), []);

    const renderThumb = (imageUrl: string | null | undefined, label: string) => {
        const letter = (label || "P").slice(0, 1).toUpperCase();
        return <div className="thumb">{imageUrl ? <img src={imageUrl} alt={label} /> : <div className="thumbFallback">{letter}</div>}</div>;
    };

    const renderList = <T,>(items: T[], emptyText: string, render: (item: T) => ReactNode, className = "dashItemGrid") =>
        items.length ? <div className={className}>{items.map(render)}</div> : <EmptyState text={emptyText} />;
    const viewListingAction = (spotId: string) => (
        <Link to={`/spots/${spotId}`} className="btn">
            View listing
        </Link>
    );
    const receiptErrorFooter = (bookingId: string) =>
        paymentReceiptErrors[bookingId] ? <div className="tiny muted" style={{ marginTop: 6 }}>{paymentReceiptErrors[bookingId]}</div> : null;
    const resolveBookingSpot = (booking: Booking) => {
        const spot = spotById.get(booking.parking_spot_id);
        return {
            spot,
            title: spot?.title ?? "Parking spot",
            address: shortAddress(spot?.address_text),
        };
    };

    async function runBusyAction(id: string, successMessage: string, fallbackError: string, action: (authToken: string) => Promise<void>) {
        if (!token) return;
        const authToken = token;
        setBusyId(id);
        setErr(null);
        setMsg(null);
        try {
            await action(authToken);
            setMsg(successMessage);
            await loadAll();
        } catch (error: unknown) {
            setErr(readErrorMessage(error, fallbackError));
        } finally {
            setBusyId(null);
        }
    }

    async function cancelBooking(id: string) {
        await runBusyAction(id, "Booking cancelled.", "Cancel failed", async (authToken) => {
            await apiPatch<{ booking: Booking }>(`/bookings/${id}/cancel`, {}, authToken);
        });
    }

    async function acceptBid(spotId: string, bidId: string) {
        await runBusyAction(bidId, "Bid accepted.", "Accept failed", async (authToken) => {
            await apiPost(`/auctions/${spotId}/accept`, { bid_id: bidId }, authToken);
        });
    }

    async function rejectBid(spotId: string, bidId: string) {
        await runBusyAction(bidId, "Bid rejected.", "Reject failed", async (authToken) => {
            await apiPost(`/auctions/${spotId}/reject`, { bid_id: bidId }, authToken);
        });
    }

    async function handleRefreshConnectStatus() {
        const result = await refreshConnectStatus();
        if (!result.ok && result.error) {
            setErr(result.error);
        }
    }

    async function handleBeginConnectOnboarding(mode: "stripe" | "demo" = "stripe") {
        setErr(null);
        setMsg(null);
        const result = await beginConnectOnboarding(mode);
        if (!result.ok && result.error) {
            setErr(result.error);
            return;
        }
        if (result.ok && result.message) {
            setMsg(result.message);
        }
    }

    async function handleOpenConnectDashboard() {
        setErr(null);
        const result = await openConnectDashboard();
        if (!result.ok) {
            setErr(result.error);
        }
    }

    function expandAndScrollPayouts() {
        setCollapsedSections((prev) => ({ ...prev, txStripe: false }));
        window.setTimeout(() => payoutsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    }

    function focusStripePayoutsCard() {
        setActiveSection("transactions");
        expandAndScrollPayouts();
    }

    async function handleTopStripeDashboard() {
        if (!connect?.account_id || !connect.onboarding_complete || connect.demo_bypass) {
            focusStripePayoutsCard();
            return;
        }
        await handleOpenConnectDashboard();
    }

    async function openPaymentReceipt(bookingId: string) {
        if (!token) return;
        setPaymentReceiptErrors((prev) => ({ ...prev, [bookingId]: null }));
        setReceiptLoadingId(bookingId);
        try {
            const response = await apiGet<{ receipt: { receipt_url: string | null } }>(`/payments/booking/${bookingId}/receipt`, token);
            const url = response.receipt?.receipt_url;
            if (!url) {
                setPaymentReceiptErrors((prev) => ({ ...prev, [bookingId]: "Stripe receipt link is not available yet." }));
                return;
            }
            window.open(url, "_blank", "noopener,noreferrer");
        } catch (error: unknown) {
            setPaymentReceiptErrors((prev) => ({ ...prev, [bookingId]: readErrorMessage(error, "Failed to load Stripe receipt.") }));
        } finally {
            setReceiptLoadingId((prev) => (prev === bookingId ? null : prev));
        }
    }

    const renderDriverBookings = () => (
        <SectionCard
            tone="driver"
            title="My Bookings"
            subtitle="Your own bookings as a driver."
            badge={<span className="badge badge--cool">{bookings.length} bookings</span>}
            collapsed={collapsedSections.driverBookings}
            onToggle={() => toggleSection("driverBookings")}
        >
            {renderList(sortedMyBookings, "No bookings yet.", (booking) => {
                const status = bookingStatusView(booking.status);
                const { spot, title, address } = resolveBookingSpot(booking);
                return (
                    <DashItemCard
                        key={booking.id}
                        className="dashItem--driver"
                        thumb={renderThumb(spot?.image_url, title)}
                        title={title}
                        subtitle={address}
                        amount={booking.pay_method === "money" ? `-${POUND}${toFiniteNumber(booking.total_price_gbp).toFixed(2)}` : `-${booking.total_points ?? 0} pts`}
                        amountClassName="dashAmount dashAmount--outgoing"
                        badges={[{ label: status.label, className: status.badgeClass }, { label: capitalizeLabel(booking.pay_method) }]}
                        fields={
                            <>
                                <TimeRow start={booking.start_time} end={booking.end_time} />
                                <OwnerContactDetails
                                    email={booking.owner_contact_email}
                                    phone={booking.owner_contact_phone}
                                    info={booking.owner_contact_info}
                                />
                            </>
                        }
                        actions={
                            <>
                                {booking.pay_method === "money" && (
                                    <>
                                        <button className="btn btn-primary" onClick={() => openPaymentReceipt(booking.id)} disabled={receiptLoadingId === booking.id}>
                                            {receiptLoadingId === booking.id ? "Loading receipt..." : "Open Stripe receipt"}
                                        </button>
                                        <Link to={`/pay/${booking.id}`} className="btn">Booking confirmation</Link>
                                    </>
                                )}
                                {booking.status === "pending" && <button onClick={() => cancelBooking(booking.id)} disabled={busyId === booking.id} className="btn">Cancel</button>}
                            </>
                        }
                        footer={receiptErrorFooter(booking.id)}
                    />
                );
            })}
        </SectionCard>
    );

    const renderMyPendingBids = () => (
        <SectionCard
            tone="driver"
            title="My Pending Bids"
            subtitle="Pending bids waiting for owner approval."
            badge={<span className="badge badge--cool">{myAuctionBids.length} pending</span>}
            collapsed={collapsedSections.driverPendingBids}
            onToggle={() => toggleSection("driverPendingBids")}
        >
            {renderList(sortedMyAuctionBids, "No pending bids.", (bid) => {
                const isPoints = (bid.pay_method ?? "money") === "points";
                return (
                    <DashItemCard
                        key={bid.id}
                        className="dashItem--driver"
                        thumb={renderThumb(undefined, bid.spot_title ?? "Auction listing")}
                        title={bid.spot_title ?? "Auction listing"}
                        subtitle={isPoints ? `${bid.amount_points ?? 0} pts` : `${POUND}${toFiniteNumber(bid.amount_gbp).toFixed(2)}`}
                        badges={[{ label: capitalizeLabel(bid.status) }, { label: "Owner review" }]}
                        fields={bid.start_time && bid.end_time ? <TimeRow start={bid.start_time} end={bid.end_time} /> : null}
                        actions={<><Link to={`/bids/${bid.id}`} className="btn btn-primary">View local receipt</Link><Link to={`/spots/${bid.parking_spot_id}`} className="btn">View listing</Link></>}
                    />
                );
            })}
        </SectionCard>
    );

    const renderDriverUpcoming = () => (
        <SectionCard
            tone="driver"
            title="Upcoming Schedule"
            subtitle="Upcoming time slots you booked from other owners."
            badge={<span className="badge badge--cool">{driverUpcoming.length} upcoming</span>}
            collapsed={collapsedSections.driverUpcoming}
            onToggle={() => toggleSection("driverUpcoming")}
        >
            {renderList(driverUpcoming, "No upcoming driver bookings.", (booking) => {
                const { spot, title, address } = resolveBookingSpot(booking);
                return (
                    <DashItemCard
                        key={booking.id}
                        className="dashItem--driver"
                        thumb={renderThumb(spot?.image_url, title)}
                        title={title}
                        subtitle={address}
                        amount={booking.pay_method === "points" ? `-${booking.total_points ?? 0} pts` : `-${POUND}${toFiniteNumber(booking.total_price_gbp).toFixed(2)}`}
                        amountClassName="dashAmount dashAmount--outgoing"
                        badges={[{ label: "Upcoming", className: "badge badge--cool" }]}
                        fields={
                            <>
                                <TimeRow start={booking.start_time} end={booking.end_time} />
                                <OwnerContactDetails
                                    email={booking.owner_contact_email}
                                    phone={booking.owner_contact_phone}
                                    info={booking.owner_contact_info}
                                />
                            </>
                        }
                        actions={viewListingAction(booking.parking_spot_id)}
                    />
                );
            })}
        </SectionCard>
    );

    const renderMyListings = () => (
        <SectionCard
            tone="owner"
            title="My Listings"
            subtitle="Parking spaces you've published."
            badge={<span className="badge badge--warm">{myListings.length} listings</span>}
            collapsed={collapsedSections.ownerListings}
            onToggle={() => toggleSection("ownerListings")}
        >
            {myListings.length === 0 ? <EmptyState text="No listings yet." linkTo="/create-listing" linkLabel="Create one" /> : renderList(sortedMyListings, "No listings yet.", (spot) => {
                const price = toFiniteNumber(spot.price_gbp);
                const auctionStart = Number(spot.auction_start_price_gbp ?? 0);
                const priceLabel = spot.mode === "auction" ? `Min bid ${POUND}${auctionStart.toFixed(2)}` : price > 0 ? `${POUND}${price.toFixed(2)}` : "Free";
                return (
                    <DashItemCard
                        key={spot.id}
                        className="dashItem--listings"
                        thumb={renderThumb(spot.image_url, spot.title)}
                        title={spot.title}
                        subtitle={shortAddress(spot.address_text)}
                        amount={priceLabel}
                        badges={[{ label: capitalizeLabel(spot.mode) }, spot.is_active === false ? { label: "Inactive", className: "badge badge--warm" } : null]}
                        actions={<><Link to={`/spots/${spot.id}`} className="btn">View listing</Link><Link to={`/create-listing?edit=${spot.id}`} className="btn btn-primary">Edit listing</Link></>}
                    />
                );
            })}
        </SectionCard>
    );

    const renderOwnerConfirmed = () => (
        <SectionCard
            tone="owner"
            title="Booked Slots"
            subtitle="Confirmed bookings made by other users on your spaces."
            badge={<span className="badge badge--warm">{confirmedOwnerBookings.length} confirmed</span>}
            collapsed={collapsedSections.ownerConfirmed}
            onToggle={() => toggleSection("ownerConfirmed")}
        >
            {renderList(confirmedOwnerBookings, "No confirmed bookings yet.", (booking) => {
                const { spot, title, address } = resolveBookingSpot(booking);
                return (
                    <DashItemCard
                        key={booking.id}
                        className="dashItem--owner"
                        thumb={renderThumb(spot?.image_url, title)}
                        title={title}
                        subtitle={address}
                        amount={booking.pay_method === "money" ? `+${POUND}${toFiniteNumber(booking.total_price_gbp).toFixed(2)}` : undefined}
                        amountClassName="dashAmount dashAmount--incoming"
                        badges={[{ label: "Confirmed", className: "badge badge--green" }, { label: capitalizeLabel(booking.pay_method) }]}
                        fields={<TimeRow start={booking.start_time} end={booking.end_time} />}
                        actions={viewListingAction(booking.parking_spot_id)}
                    />
                );
            })}
        </SectionCard>
    );

    const renderOwnerPendingBids = () => (
        <SectionCard
            tone="owner"
            title="Pending Bids"
            subtitle="Approve or reject pending offers on your listings."
            badge={<span className="badge badge--warm">{pendingOwnerBids.length} pending</span>}
            collapsed={collapsedSections.ownerPending}
            onToggle={() => toggleSection("ownerPending")}
        >
            {renderList(pendingOwnerBids, "No bids yet.", (bid) => {
                const isPoints = (bid.pay_method ?? "money") === "points";
                return (
                    <DashItemCard
                        key={bid.id}
                        className="dashItem--owner"
                        thumb={renderThumb(undefined, bid.spot_title ?? "Auction listing")}
                        title={bid.spot_title ?? "Auction listing"}
                        subtitle={bid.bidder_name ?? bid.bidder_email ?? "Bidder"}
                        amount={isPoints ? `${bid.amount_points ?? 0} pts` : `${POUND}${toFiniteNumber(bid.amount_gbp).toFixed(2)}`}
                        badges={[{ label: "Action required", className: "badge badge--warm" }, { label: isPoints ? "Points" : "Money" }]}
                        fields={bid.start_time && bid.end_time ? <TimeRow start={bid.start_time} end={bid.end_time} /> : null}
                        actions={<><Link to={`/bids/${bid.id}`} className="btn">View local receipt</Link><button onClick={() => acceptBid(bid.parking_spot_id, bid.id)} disabled={busyId === bid.id} className="btn btn-primary">Accept</button><button onClick={() => rejectBid(bid.parking_spot_id, bid.id)} disabled={busyId === bid.id} className="btn">Reject</button></>}
                    />
                );
            })}
        </SectionCard>
    );

    const renderOwnerUpcoming = () => (
        <SectionCard
            tone="owner"
            title="Owner Upcoming"
            subtitle="Upcoming confirmed bookings on your own listings."
            badge={<span className="badge badge--warm">{ownerUpcoming.length} upcoming</span>}
            collapsed={collapsedSections.ownerUpcoming}
            onToggle={() => toggleSection("ownerUpcoming")}
        >
            {renderList(ownerUpcoming, "No upcoming owner bookings.", (booking) => {
                const { spot, title, address } = resolveBookingSpot(booking);
                const isPoints = booking.pay_method === "points";
                return (
                    <DashItemCard
                        key={booking.id}
                        className="dashItem--owner"
                        thumb={renderThumb(spot?.image_url, title)}
                        title={title}
                        subtitle={address}
                        amount={isPoints ? `+${booking.total_points ?? 0} pts` : `+${POUND}${toFiniteNumber(booking.total_price_gbp).toFixed(2)}`}
                        amountClassName="dashAmount dashAmount--incoming"
                        badges={[{ label: "Upcoming", className: "badge badge--green" }]}
                        fields={<TimeRow start={booking.start_time} end={booking.end_time} />}
                        actions={viewListingAction(booking.parking_spot_id)}
                    />
                );
            })}
        </SectionCard>
    );

    const renderRewards = () => (
        <SectionCard
            tone="rewards"
            title="Rewards History"
            subtitle="Points earned and spent across the platform."
            badge={<span className="badge badge--accent">Points</span>}
            collapsed={collapsedSections.txRewards}
            onToggle={() => toggleSection("txRewards")}
        >
            {renderList(sortedRewards, "No reward activity yet.", (reward) => {
                const incoming = String(reward.type ?? "").toLowerCase() === "earn";
                const flow = incoming ? "Earned" : "Spent";
                return (
                    <DashItemCard
                        key={reward.id}
                        className="dashItem--rewards"
                        thumb={renderThumb(undefined, reward.reason)}
                        title={reward.reason}
                        subtitle={`${flow} points`}
                        amount={`${incoming ? "+" : "-"}${reward.amount} pts`}
                        amountClassName={incoming ? "dashAmount dashAmount--incoming" : "dashAmount dashAmount--outgoing"}
                        badges={[{ label: flow, className: `badge ${incoming ? "badge--green" : "badge--rose"}` }]}
                        fields={<TimeRow label="Date" value={formatDateTimeLocal(reward.created_at)} />}
                    />
                );
            })}
        </SectionCard>
    );

    const renderPayments = () => (
        <SectionCard
            tone="payments"
            title="Transaction History"
            subtitle="Incoming and outgoing payment records."
            badge={<span className="badge badge--green">Total earned: {POUND}{totalEarned.toFixed(2)}</span>}
            collapsed={collapsedSections.txPayments}
            onToggle={() => toggleSection("txPayments")}
        >
            {renderList(payments, "No payments yet.", (payment) => {
                const flow = moneyFlowView(payment.direction);
                const title = payment.spot_title || "Parking spot";
                return (
                    <DashItemCard
                        key={payment.id}
                        className={`dashItem--payments ${flow.cardClass}`}
                        thumb={renderThumb(undefined, title)}
                        title={title}
                        subtitle={shortAddress(payment.spot_address)}
                        amount={`${flow.sign}${POUND}${toFiniteNumber(payment.amount_gbp).toFixed(2)}`}
                        amountClassName={flow.amountClass}
                        badges={[{ label: flow.label, className: flow.badgeClass }, { label: capitalizeLabel(payment.status) }]}
                        fields={<><TimeRow label="Booking window" start={payment.start_time} end={payment.end_time} /><TimeRow label="Paid at" value={formatDateTimeLocal(payment.created_at)} /></>}
                        actions={<>{payment.direction === "outgoing" && <><button className="btn btn-primary" onClick={() => openPaymentReceipt(payment.booking_id)} disabled={receiptLoadingId === payment.booking_id}>{receiptLoadingId === payment.booking_id ? "Loading receipt..." : "Open Stripe receipt"}</button><Link to={`/pay/${payment.booking_id}`} className="btn">Booking confirmation</Link></>}{payment.direction === "incoming" && <button className="btn btn-primary" onClick={handleOpenConnectDashboard} disabled={connectBusy || !connect?.onboarding_complete || !!connect?.demo_bypass}>Open Stripe dashboard</button>}</>}
                        footer={receiptErrorFooter(payment.booking_id)}
                    />
                );
            })}
        </SectionCard>
    );

    const renderStripeAccount = () => (
        <SectionCard
            tone="payments"
            title="Stripe Account"
            subtitle={connect?.demo_bypass ? "Demo payouts are simulated. No Stripe onboarding required." : "Connect Stripe to withdraw your earnings."}
            badge={<span className={connectBadgeClass}>{connectLabel}</span>}
            style={{ gridColumn: "1 / -1" }}
            collapsed={collapsedSections.txStripe}
            onToggle={() => toggleSection("txStripe")}
        >
            <div ref={payoutsRef} className="stack">
                <div className="settingRow"><div className="settingRowTitle"><div className="tiny muted">Connected account</div><div className="spotInfoValue">{connect?.demo_bypass ? "Demo simulation" : connect?.account_id ?? "Not connected"}</div></div><span className={connect?.charges_enabled ? "badge badge--green" : "badge badge--warm"}>{connect?.charges_enabled ? "Charges enabled" : "Charges pending"}</span></div>
                <div className="settingRow"><div className="settingRowTitle"><div className="tiny muted">Payout capability</div><div className="spotInfoValue">{connect?.payouts_enabled ? "Enabled" : "Pending"}</div></div><span className={connect?.details_submitted ? "badge badge--cool" : "badge badge--warm"}>{connect?.details_submitted ? "Details submitted" : "Details required"}</span></div>
                <div className="rowInline">
                    {connect?.demo_available && !connect?.demo_bypass && !connect?.account_id && <button className="btn" onClick={() => handleBeginConnectOnboarding("demo")} disabled={connectBusy}>Use demo payouts</button>}
                    <button className="btn btn-primary" onClick={handleOpenConnectDashboard} disabled={connectBusy || !connect?.onboarding_complete || !!connect?.demo_bypass}>Open Stripe dashboard</button>
                    <button className="btn" onClick={() => handleBeginConnectOnboarding("stripe")} disabled={connectBusy}>{connectBusy ? "Opening..." : connect?.demo_bypass ? "Connect Stripe instead" : !connect?.account_id ? "Connect Stripe" : connect.onboarding_complete ? "Update Stripe details" : "Continue onboarding"}</button>
                    <button className="btn" onClick={handleRefreshConnectStatus} disabled={connectBusy}>Refresh status</button>
                </div>
            </div>
        </SectionCard>
    );

    if (!token) return <Navigate to="/" replace />;

    return (
        <div className="container dashboardPage">
            <div className="pageHeader dashboardHero">
                <div className="dashboardHeroMain">
                    <div className="dashboardHeroCopy">
                        <div className="heroKicker">DASHBOARD</div>
                        <div className="heroTitle">Your dashboard</div>
                        <div className="heroSub muted">Bookings, listings, payouts, and points in one place.</div>
                    </div>
                    <div className="dashboardHeroReceipt" aria-label="Activity summary">
                        <div className="dashboardHeroReceiptHead">
                            <span className="dashboardHeroReceiptTitle">Activity receipt</span>
                            <span className="dashboardHeroReceiptDate">{receiptDate}</span>
                        </div>
                        <div className="dashboardHeroReceiptBody">
                            {headerStats.map((stat) => (
                                <div key={stat.label} className="dashboardHeroReceiptRow">
                                    <span>{stat.label}</span>
                                    <strong>{stat.value}</strong>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
            <div className="dashboardTopActions">
                <button className="btn btn-primary" onClick={handleTopStripeDashboard} disabled={connectBusy}>
                    {connectBusy ? "Opening..." : "Open Stripe dashboard"}
                </button>
            </div>

            {err && <div className="card formSection" style={{ color: "crimson" }}>{err}</div>}
            {msg && <div className="card formSection">{msg}</div>}

            <div className="dashboardLayout" aria-busy={loading}>
                <aside className="dashboardRail" aria-label="Dashboard sections">
                    {NAV_SECTIONS.map((section) => (
                        <button key={section.key} type="button" className={`dashboardNavBtn dashboardNavBtn--${section.tone}${activeSection === section.key ? " is-active" : ""}`} onClick={() => setActiveSection(section.key)}>
                            <div className="dashboardNavText"><span className="dashboardNavTitle">{section.title}</span><span className="dashboardNavSub">{section.subtitle}</span></div>
                        </button>
                    ))}
                </aside>

                <div className="dashboardPanel">
                    {activeSection === "manageBookings" && <div className="dashGrid dashGrid--withinGroup">{renderDriverBookings()}{renderMyPendingBids()}{renderDriverUpcoming()}</div>}
                    {activeSection === "manageListings" && <div className="dashGrid dashGrid--withinGroup">{renderMyListings()}{renderOwnerConfirmed()}{renderOwnerPendingBids()}{renderOwnerUpcoming()}</div>}
                    {activeSection === "transactions" && <div className="dashGrid dashGrid--withinGroup">{renderRewards()}{renderPayments()}{renderStripeAccount()}</div>}
                </div>
            </div>
        </div>
    );
}
