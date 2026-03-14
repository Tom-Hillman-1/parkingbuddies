import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tab, TabList, TabPanel, Tabs } from "react-aria-components";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { AppButton } from "../components/ui/AppForm";
import { AppDisclosure } from "../components/ui/AppDisclosure";
import { apiGet, apiPost, readErrorMessage } from "../lib/api";
import { useAuth, useStripeConnect } from "../lib/auth";
import {
    calcAuctionPointsTotal,
    calcAuctionUnitsForRange,
    capitalizeLabel,
    formatDateDisplay,
    formatDateTimeLocal,
    formatGbp,
    toFiniteNumber,
    type PriceUnit,
} from "./pagesShared";
import type { Booking as SharedBooking, ParkingSpot, RewardTransaction, User } from "../types";

type Me = User;
type Booking = SharedBooking & {
    owner_user_id: string;
    total_points: number | null;
    spot_mode?: "free" | "rent" | "auction";
    payment_status?: string | null;
    payment_provider_ref?: string | null;
};
type RewardTx = RewardTransaction;
type DashboardSection = "manageBookings" | "manageListings" | "transactions";
type SectionTone = "driver" | "owner" | "rewards" | "payments";
type Payment = {
    id: string;
    booking_id: string;
    provider: string;
    status: string;
    direction?: "incoming" | "outgoing";
    amount_gbp: number | string | null | undefined;
    created_at: string;
    start_time: string;
    end_time: string;
    spot_title: string;
    spot_address: string;
};
type AuctionBid = {
    id: string;
    parking_spot_id: string;
    amount_gbp: number | string | null | undefined;
    amount_points?: number | null;
    price_unit?: PriceUnit;
    pay_method?: "money" | "points";
    status: string;
    created_at: string;
    start_time?: string;
    end_time?: string;
    bidder_name?: string;
    bidder_email?: string;
    spot_title?: string;
};
type DashboardData = {
    me: Me;
    bookings: Booking[];
    ownerBookings: Booking[];
    rewards: RewardTx[];
    spots: ParkingSpot[];
    payments: Payment[];
    auctionBids: AuctionBid[];
    myAuctionBids: AuctionBid[];
};

const NAV_SECTIONS: Array<{ key: DashboardSection; title: string; tone: "driver" | "owner" | "payments" }> = [
    { key: "manageBookings", title: "Manage bookings", tone: "driver" },
    { key: "manageListings", title: "Manage listings", tone: "owner" },
    { key: "transactions", title: "Transactions", tone: "payments" },
];
const SEARCH_PARAM_TO_SECTION: Record<string, DashboardSection> = {
    myBookings: "manageBookings",
    myAuctionBids: "manageBookings",
    driverUpcoming: "manageBookings",
    myListings: "manageListings",
    ownerConfirmed: "manageListings",
    ownerPending: "manageListings",
    ownerUpcoming: "manageListings",
    rewards: "transactions",
    payments: "transactions",
    payouts: "transactions",
};

const shortAddress = (raw: string | null | undefined, maxLen = 52) => {
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

const estimateAuctionBidPoints = (bid: AuctionBid) => {
    if ((bid.pay_method ?? "money") !== "points" || !bid.start_time || !bid.end_time) {
        return toFiniteNumber(bid.amount_points);
    }
    const units = calcAuctionUnitsForRange(bid.start_time, bid.end_time, bid.price_unit ?? "hour");
    return calcAuctionPointsTotal(bid.amount_points, units);
};

const isMoneyBookingSettled = (booking: Booking) => {
    if (booking.pay_method !== "money") return true;
    if (toFiniteNumber(booking.total_price_gbp) <= 0) return true;
    const paymentStatus = String(booking.payment_status ?? "").toLowerCase();
    return paymentStatus === "succeeded" || String(booking.status ?? "").toLowerCase() === "confirmed";
};

const bookingStatusView = (booking: Booking) => {
    const value = String(booking.status ?? "").toLowerCase();
    if (value === "pending" && isMoneyBookingSettled(booking)) {
        return { label: "Approved", className: "badge badge--green" };
    }
    if (value === "pending") return { label: "Pending", className: "badge badge--warm" };
    if (value === "confirmed" || value === "approved" || value === "accepted") return { label: "Approved", className: "badge badge--green" };
    if (value === "cancelled" || value === "rejected" || value === "declined") return { label: "Rejected", className: "badge badge--rose" };
    return { label: capitalizeLabel(value || "unknown"), className: "badge" };
};

function DashboardDisclosureCard({
    title,
    subtitle,
    tone,
    count,
    countClassName = "badge",
    isLast,
    children,
}: {
    title: string;
    subtitle: string;
    tone: SectionTone;
    count: ReactNode;
    countClassName?: string;
    isLast?: boolean;
    children: ReactNode;
}) {
    return (
        <AppDisclosure
            defaultExpanded
            className={`dashboardDisclosure dashboardDisclosure--${tone}${isLast ? " is-last" : ""}`}
            triggerClassName="dashboardDisclosureTrigger"
            panelClassName="dashboardDisclosurePanel"
            trigger={(isExpanded) => (
                <div className="dashboardDisclosureHeader">
                    <div className="dashboardDisclosureLeft">
                        <span className={`dashboardDisclosureDot dashboardDisclosureDot--${tone}`} />
                        <div>
                            <div className="dashboardDisclosureTitle">{title}</div>
                            <div className="tiny muted">{subtitle}</div>
                        </div>
                    </div>
                    <div className="dashboardDisclosureRight">
                        <span className={countClassName}>{count}</span>
                        <span className={`dashboardDisclosureChevron${isExpanded ? " is-open" : ""}`} aria-hidden="true">
                            {">"}
                        </span>
                    </div>
                </div>
            )}
        >
            {children}
        </AppDisclosure>
    );
}

function SlotCard({
    tone,
    imageUrl,
    title,
    address,
    amount,
    badges,
    time,
    details,
    actions,
    errorText,
}: {
    tone: "blue" | "green" | "rose" | "sage";
    imageUrl?: string | null;
    title: string;
    address: string;
    amount?: string;
    badges?: ReactNode;
    time?: string;
    details?: ReactNode;
    actions?: ReactNode;
    errorText?: string | null;
}) {
    const letter = (title || "P").slice(0, 1).toUpperCase();
    return (
        <article className="dashboardSlotCard">
            <div className={`dashboardSlotTop dashboardSlotTop--${tone}`}>
                <div className="dashboardSlotBubble" />
                <div className="dashboardSlotBubble dashboardSlotBubble--small" />
                <div className="dashboardSlotAvatar">
                    {imageUrl ? <img src={imageUrl} alt={title} /> : <span>{letter}</span>}
                </div>
                {amount ? <div className="dashboardSlotAmount">{amount}</div> : null}
            </div>
            <div className="dashboardSlotBody">
                <div className="dashboardSlotMain">
                    <div className="dashboardSlotTitle">{title}</div>
                    <div className="tiny muted dashboardSlotAddress">{address}</div>
                    {badges ? <div className="rowInline dashboardSlotBadges">{badges}</div> : null}
                    {time ? (
                        <div className="dashboardSlotMetaBlock">
                            <div className="dashboardSlotMetaLabel">Window</div>
                            <div className="dashboardSlotMetaValue">{time}</div>
                        </div>
                    ) : null}
                    <div className="dashboardSlotDetails">{details}</div>
                    {errorText ? <div className="dashboardSlotMetaValue">{errorText}</div> : null}
                </div>
                {actions ? <div className="dashboardSlotActions">{actions}</div> : null}
            </div>
        </article>
    );
}

export default function DashboardPage() {
    const { token } = useAuth();
    const [searchParams] = useSearchParams();

    const [err, setErr] = useState<string | null>(null);
    const [msg, setMsg] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [receiptLoadingId, setReceiptLoadingId] = useState<string | null>(null);
    const [paymentReceiptErrors, setPaymentReceiptErrors] = useState<Record<string, string | null>>({});
    const [selectedTab, setSelectedTab] = useState<DashboardSection>("manageBookings");

    const payoutsRef = useRef<HTMLDivElement | null>(null);

    const { connect, connectBusy, refreshConnectStatus, beginConnectOnboarding, openConnectDashboard } = useStripeConnect(token);
    const dashboardQuery = useQuery<DashboardData>({
        queryKey: ["dashboard-data", token],
        enabled: Boolean(token),
        staleTime: 15000,
        queryFn: async () => {
            if (!token) throw new Error("Missing auth token");
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
            return {
                me: meRes.user,
                bookings: bookingsRes.bookings ?? [],
                ownerBookings: ownerBookingsRes.bookings ?? [],
                rewards: rewardsRes.rewards ?? [],
                spots: spotsRes.parking_spots ?? [],
                payments: paymentsRes.payments ?? [],
                auctionBids: bidsRes.bids ?? [],
                myAuctionBids: myBidsRes.bids ?? [],
            };
        },
    });

    useEffect(() => {
        if (!token) return;
        void refreshConnectStatus(true);
    }, [token, refreshConnectStatus]);

    const dashboardData = dashboardQuery.data;
    const me = dashboardData?.me ?? null;
    const bookings = useMemo(() => dashboardData?.bookings ?? [], [dashboardData?.bookings]);
    const ownerBookings = useMemo(() => dashboardData?.ownerBookings ?? [], [dashboardData?.ownerBookings]);
    const spots = useMemo(() => dashboardData?.spots ?? [], [dashboardData?.spots]);
    const rewards = useMemo(() => dashboardData?.rewards ?? [], [dashboardData?.rewards]);
    const payments = useMemo(() => dashboardData?.payments ?? [], [dashboardData?.payments]);
    const auctionBids = useMemo(() => dashboardData?.auctionBids ?? [], [dashboardData?.auctionBids]);
    const myAuctionBids = useMemo(() => dashboardData?.myAuctionBids ?? [], [dashboardData?.myAuctionBids]);
    const loading = dashboardQuery.isLoading;
    const loadErr = dashboardQuery.error ? readErrorMessage(dashboardQuery.error, "Failed to load dashboard") : null;

    useEffect(() => {
        const tab = searchParams.get("tab");
        if (!tab) return;
        const section = SEARCH_PARAM_TO_SECTION[tab];
        if (!section) return;
        setSelectedTab(section);
        if (tab === "payouts") {
            window.setTimeout(() => payoutsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
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
            .filter((booking) => {
                if (String(booking.status ?? "").toLowerCase() !== "pending") return true;
                return isMoneyBookingSettled(booking);
            })
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
        { label: "Total earned", value: formatGbp(totalEarned) },
    ];
    const receiptDate = useMemo(() => formatDateDisplay(new Date()), []);

    const resolveBookingSpot = (booking: Booking) => {
        const spot = spotById.get(booking.parking_spot_id);
        return {
            spot,
            title: spot?.title ?? "Parking spot",
            address: shortAddress(spot?.address_text),
        };
    };

    const openPaymentReceipt = async (bookingId: string) => {
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
    };

    const runBusyAction = async (id: string, successMessage: string, fallbackError: string, action: (authToken: string) => Promise<void>) => {
        if (!token) return;
        setBusyId(id);
        setErr(null);
        setMsg(null);
        try {
            await action(token);
            setMsg(successMessage);
            await dashboardQuery.refetch();
        } catch (error: unknown) {
            setErr(readErrorMessage(error, fallbackError));
        } finally {
            setBusyId(null);
        }
    };

    const acceptBid = async (spotId: string, bidId: string) => {
        await runBusyAction(bidId, "Bid accepted.", "Accept failed", async (authToken) => {
            await apiPost(`/auctions/${spotId}/accept`, { bid_id: bidId }, authToken);
        });
    };

    const rejectBid = async (spotId: string, bidId: string) => {
        await runBusyAction(bidId, "Bid rejected.", "Reject failed", async (authToken) => {
            await apiPost(`/auctions/${spotId}/reject`, { bid_id: bidId }, authToken);
        });
    };

    const handleRefreshConnectStatus = async () => {
        const result = await refreshConnectStatus();
        if (!result.ok && result.error) setErr(result.error);
    };

    const handleBeginConnectOnboarding = async (mode: "stripe" | "demo" = "stripe") => {
        setErr(null);
        setMsg(null);
        const result = await beginConnectOnboarding(mode);
        if (!result.ok && result.error) {
            setErr(result.error);
            return;
        }
        if (result.ok && result.message) setMsg(result.message);
    };

    const handleOpenConnectDashboard = async () => {
        setErr(null);
        const result = await openConnectDashboard();
        if (!result.ok) setErr(result.error);
    };

    const handleTopStripeDashboard = async () => {
        if (!connect?.account_id || !connect.onboarding_complete || connect.demo_bypass) {
            setSelectedTab("transactions");
            window.setTimeout(() => payoutsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
            return;
        }
        await handleOpenConnectDashboard();
    };

    const slotTime = (start?: string | null, end?: string | null) => (start && end ? `${formatDateTimeLocal(start)} -> ${formatDateTimeLocal(end)}` : "");

    const renderBadgeRow = (items: Array<{ label: ReactNode; className?: string } | null | false>) =>
        items
            .filter((item): item is { label: ReactNode; className?: string } => !!item)
            .map((item, index) => (
                <span key={index} className={item.className ?? "badge"}>
                    {item.label}
                </span>
            ));

    if (!token) return <Navigate to="/" replace />;

    return (
        <div className="container dashboardPage dashboardModern">
            <div className="dashboardHeroSplit">
                <div className="pageHeader dashboardHero dashboardHeroCard">
                    <div className="dashboardHeroBubble" />
                    <div className="dashboardHeroBubble dashboardHeroBubble--small" />
                    <div className="dashboardHeroBubble dashboardHeroBubble--low" />
                    <div className="dashboardHeroCopy">
                        <div className="heroKicker">DASHBOARD</div>
                        <div className="heroTitle">Your dashboard</div>
                        <div className="heroSub muted">Bookings, listings, payouts, and points in one place.</div>
                        <div className="dashboardHeroActions">
                            <AppButton variant="primary" onPress={handleTopStripeDashboard} disabled={connectBusy}>
                                {connectBusy ? "Opening..." : "Open Stripe dashboard"}
                            </AppButton>
                        </div>
                    </div>
                </div>

                <aside className="dashboardHeroReceiptWindow" aria-label="Activity summary">
                    <div className="dashboardHeroReceiptTop dashboardHeroReceiptTop--blue">
                        <div className="dashboardHeroBubble" />
                        <div className="dashboardHeroBubble dashboardHeroBubble--small" />
                        <div className="dashboardHeroReceiptHead">
                            <span className="dashboardHeroReceiptTitle">ACTIVITY RECEIPT</span>
                            <span className="dashboardHeroReceiptDate">{receiptDate}</span>
                        </div>
                    </div>
                    <div className="dashboardHeroReceiptBody">
                        {headerStats.map((stat) => (
                            <div key={stat.label} className="dashboardHeroReceiptRow">
                                <span className="dashboardHeroReceiptLabel">{stat.label}</span>
                                <strong className={`dashboardHeroReceiptValue${stat.label === "Points" ? " dashboardHeroReceiptValue--points" : ""}`}>{stat.value}</strong>
                            </div>
                        ))}
                    </div>
                </aside>
            </div>

            {(err ?? loadErr) && <div className="card formSection" style={{ color: "crimson" }}>{err ?? loadErr}</div>}
            {msg && <div className="card formSection">{msg}</div>}

            <Tabs
                aria-label="Dashboard sections"
                className="dashboardPanel"
                selectedKey={selectedTab}
                onSelectionChange={(key) => setSelectedTab(key as DashboardSection)}
            >
                <TabList className="appTabList dashboardTabList">
                    {NAV_SECTIONS.map((section) => (
                        <Tab
                            key={section.key}
                            id={section.key}
                            className={({ isSelected }) =>
                                `appTab dashboardTab dashboardTab--${section.tone}${isSelected ? " is-active" : ""}`.trim()
                            }
                        >
                            {section.title}
                        </Tab>
                    ))}
                </TabList>

                <TabPanel id="manageBookings" className="dashboardTabPanel" aria-busy={loading}>
                    <div className="dashboardDisclosureStack">
                        <DashboardDisclosureCard
                                tone="driver"
                                title="My Bookings"
                                subtitle="Your bookings as a driver."
                                count={bookings.length}
                                countClassName="badge badge--cool"
                            >
                                {sortedMyBookings.length === 0 ? (
                                    <div className="muted">No bookings yet.</div>
                                ) : (
                                    <div className="dashboardScrollRow">
                                        {sortedMyBookings.map((booking) => {
                                            const status = bookingStatusView(booking);
                                            const { spot, title, address } = resolveBookingSpot(booking);
                                                const amount = booking.pay_method === "money" ? `-${formatGbp(booking.total_price_gbp)}` : `-${booking.total_points ?? 0} pts`;
                                            return (
                                                <SlotCard
                                                    key={booking.id}
                                                    tone="blue"
                                                    imageUrl={spot?.image_url}
                                                    title={title}
                                                    address={address}
                                                    amount={amount}
                                                    badges={renderBadgeRow([
                                                        { label: status.label, className: status.className },
                                                        { label: capitalizeLabel(booking.pay_method) },
                                                    ])}
                                                    time={slotTime(booking.start_time, booking.end_time)}
                                                    details={
                                                        <div className="dashboardContactBlock">
                                                            <div className="dashboardSlotMetaLabel">Contact</div>
                                                            {booking.owner_contact_email && (
                                                                <div className="dashboardContactLine">
                                                                    <span className="dashboardContactKey">Email:</span>
                                                                    <span className="dashboardContactText dashboardContactText--single">{booking.owner_contact_email}</span>
                                                                </div>
                                                            )}
                                                            {booking.owner_contact_phone && (
                                                                <div className="dashboardContactLine">
                                                                    <span className="dashboardContactKey">Phone:</span>
                                                                    <span className="dashboardContactText dashboardContactText--single">{booking.owner_contact_phone}</span>
                                                                </div>
                                                            )}
                                                            {booking.owner_contact_info && (
                                                                <div className="dashboardContactLine">
                                                                    <span className="dashboardContactKey">Info:</span>
                                                                    <span className="dashboardContactText">{booking.owner_contact_info}</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    }
                                                    actions={
                                                        <>
                                                            {booking.pay_method === "money" && (
                                                                <>
                                                                    <button className="btn btn-primary dashboardSlotActionBtn" onClick={() => openPaymentReceipt(booking.id)} disabled={receiptLoadingId === booking.id}>
                                                                        {receiptLoadingId === booking.id ? "Loading..." : "Receipt"}
                                                                    </button>
                                                                    <Link to={`/pay/${booking.id}`} className="btn dashboardSlotActionBtn">Confirmation</Link>
                                                                </>
                                                            )}
                                                        </>
                                                    }
                                                    errorText={paymentReceiptErrors[booking.id]}
                                                />
                                            );
                                        })}
                                    </div>
                                )}
                            </DashboardDisclosureCard>

                            <DashboardDisclosureCard
                                tone="driver"
                                title="My Pending Bids"
                                subtitle="Pending bids waiting for owner approval."
                                count={myAuctionBids.length}
                                countClassName="badge badge--warm"
                            >
                                {sortedMyAuctionBids.length === 0 ? (
                                    <div className="muted">No pending bids.</div>
                                ) : (
                                    <div className="dashboardScrollRow">
                                        {sortedMyAuctionBids.map((bid) => {
                                            const isPoints = (bid.pay_method ?? "money") === "points";
                                            const totalPoints = estimateAuctionBidPoints(bid);
                                            return (
                                                <SlotCard
                                                    key={bid.id}
                                                    tone="rose"
                                                    title={bid.spot_title ?? "Auction listing"}
                                                    address="Awaiting owner decision"
                                                    amount={isPoints ? `${totalPoints} pts pending` : `${formatGbp(bid.amount_gbp)} auth`}
                                                    badges={renderBadgeRow([{ label: capitalizeLabel(bid.status), className: "badge badge--warm" }, { label: "Owner review" }, { label: isPoints ? "Not deducted yet" : "Not charged yet" }])}
                                                    time={slotTime(bid.start_time, bid.end_time)}
                                                    actions={<><Link to={`/bids/${bid.id}`} className="btn btn-primary">View local receipt</Link><Link to={`/spots/${bid.parking_spot_id}`} className="btn">View listing</Link></>}
                                                />
                                            );
                                        })}
                                    </div>
                                )}
                            </DashboardDisclosureCard>

                            <DashboardDisclosureCard
                                tone="driver"
                                title="Upcoming Schedule"
                                subtitle="Upcoming slots you booked from owners."
                                count={driverUpcoming.length}
                                countClassName="badge badge--green"
                                isLast
                            >
                                {driverUpcoming.length === 0 ? (
                                    <div className="muted">No upcoming driver bookings.</div>
                                ) : (
                                    <div className="dashboardScrollRow">
                                        {driverUpcoming.map((booking) => {
                                            const { spot, title, address } = resolveBookingSpot(booking);
                                            return (
                                                <SlotCard
                                                    key={booking.id}
                                                    tone="sage"
                                                    imageUrl={spot?.image_url}
                                                    title={title}
                                                    address={address}
                                                    amount={booking.pay_method === "points" ? `-${booking.total_points ?? 0} pts` : `-${formatGbp(booking.total_price_gbp)}`}
                                                    badges={renderBadgeRow([{ label: "Upcoming", className: "badge badge--cool" }])}
                                                    time={slotTime(booking.start_time, booking.end_time)}
                                                    actions={<Link to={`/spots/${booking.parking_spot_id}`} className="btn">View listing</Link>}
                                                />
                                            );
                                        })}
                                    </div>
                                )}
                        </DashboardDisclosureCard>
                    </div>
                </TabPanel>

                <TabPanel id="manageListings" className="dashboardTabPanel" aria-busy={loading}>
                    <div className="dashboardDisclosureStack">
                        <DashboardDisclosureCard
                                tone="owner"
                                title="My Listings"
                                subtitle="Parking spaces you've published."
                                count={myListings.length}
                                countClassName="badge badge--cool"
                            >
                            {sortedMyListings.length === 0 ? (
                                <div className="muted">No listings yet. <Link to="/create-listing">Create one</Link>.</div>
                            ) : (
                                <div className="dashboardRailRow dashboardRailRow--listings">
                                    {sortedMyListings.map((spot) => {
                                        const price = toFiniteNumber(spot.price_gbp);
                                        const auctionStart = Number(spot.auction_start_price_gbp ?? 0);
                                        const priceLabel = spot.mode === "auction" ? `Min bid ${formatGbp(auctionStart)}` : price > 0 ? formatGbp(price) : "Free";
                                        return (
                                            <article key={spot.id} className="dashboardListingMiniCard">
                                                <div className={`dashboardListingMiniHeader dashboardListingMiniHeader--${spot.mode}`}>
                                                    <span className="dashboardListingMiniBubble" aria-hidden="true" />
                                                    <div className="dashboardListingMiniMode">{capitalizeLabel(spot.mode)}</div>
                                                    <div className="dashboardListingMiniPrice">{priceLabel}</div>
                                                </div>
                                                <div className="dashboardListingMiniBody">
                                                    <div className="dashboardListingMiniTitle">{spot.title}</div>
                                                    <div className="dashboardListingMiniAddress tiny muted">{shortAddress(spot.address_text)}</div>
                                                    <div className="rowInline" style={{ gap: 6 }}>
                                                        <Link to={`/spots/${spot.id}`} className="dashboardMiniBtn">View listing</Link>
                                                        <Link to={`/create-listing?edit=${spot.id}`} className="dashboardMiniBtn is-dark">Edit listing</Link>
                                                    </div>
                                                </div>
                                            </article>
                                        );
                                        })}
                                    </div>
                                )}
                            </DashboardDisclosureCard>

                            <DashboardDisclosureCard
                                tone="owner"
                                title="Booked Slots"
                                subtitle="Confirmed bookings from drivers."
                                count={confirmedOwnerBookings.length}
                                countClassName="badge badge--green"
                            >
                                {confirmedOwnerBookings.length === 0 ? (
                                    <div className="muted">No confirmed bookings yet.</div>
                                ) : (
                                    <div className="dashboardChipRow dashboardChipRow--booked">
                                        {confirmedOwnerBookings.map((booking) => {
                                            const { title, address } = resolveBookingSpot(booking);
                                            const isPoints = booking.pay_method === "points";
                                            return (
                                                <div key={booking.id} className="dashboardChip dashboardChip--strip dashboardStrip--incoming">
                                                    <div className="dashboardStripAccent" />
                                                    <div className="dashboardStripBody">
                                                        <div className="dashboardStripTop">
                                                            <div className="dashboardStripTitle">{title}</div>
                                                            <div className={`dashboardStripAmount ${isPoints ? "" : "dashboardChipAmount--in"}`}>
                                                                {isPoints ? `+${booking.total_points ?? 0} pts` : `+${formatGbp(booking.total_price_gbp)}`}
                                                            </div>
                                                        </div>
                                                        <div className="tiny muted dashboardStripMeta">{address}</div>
                                                        <div className="tiny muted dashboardStripMeta">{slotTime(booking.start_time, booking.end_time)}</div>
                                                        <div className="dashboardStripBottom">
                                                            <div className="rowInline" style={{ gap: 6 }}>
                                                                <span className="badge badge--green">Confirmed</span>
                                                                <span className="badge">{capitalizeLabel(booking.pay_method)}</span>
                                                            </div>
                                                            <Link to={`/spots/${booking.parking_spot_id}`} className="dashboardTextAction">View &gt;</Link>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </DashboardDisclosureCard>

                            <DashboardDisclosureCard
                                tone="owner"
                                title="Pending Bids"
                                subtitle="Approve or reject offers on your listings."
                                count={pendingOwnerBids.length}
                                countClassName="badge badge--warm"
                            >
                                {pendingOwnerBids.length === 0 ? (
                                    <div className="muted">No bids yet.</div>
                                ) : (
                                    <div className="dashboardScrollRow">
                                        {pendingOwnerBids.map((bid) => {
                                            const isPoints = (bid.pay_method ?? "money") === "points";
                                            const totalPoints = estimateAuctionBidPoints(bid);
                                            return (
                                                <SlotCard
                                                    key={bid.id}
                                                    tone="rose"
                                                    title={bid.spot_title ?? "Auction listing"}
                                                    address={bid.bidder_name ?? bid.bidder_email ?? "Demo Driver"}
                                                    amount={isPoints ? `${totalPoints} pts pending` : `${formatGbp(bid.amount_gbp)} auth`}
                                                    badges={renderBadgeRow([{ label: "Action required", className: "badge badge--rose" }, { label: isPoints ? "Points" : "Money" }, { label: "Charge on acceptance" }])}
                                                    time={slotTime(bid.start_time, bid.end_time)}
                                                    actions={<><Link to={`/bids/${bid.id}`} className="btn">View local receipt</Link><button className="btn btn-primary" onClick={() => acceptBid(bid.parking_spot_id, bid.id)} disabled={busyId === bid.id}>Accept</button><button className="btn" onClick={() => rejectBid(bid.parking_spot_id, bid.id)} disabled={busyId === bid.id}>Reject</button></>}
                                                />
                                            );
                                        })}
                                    </div>
                                )}
                            </DashboardDisclosureCard>

                            <DashboardDisclosureCard
                                tone="owner"
                                title="Owner Upcoming"
                                subtitle="Upcoming confirmed bookings on your listings."
                                count={ownerUpcoming.length}
                                countClassName="badge badge--green"
                                isLast
                            >
                                {ownerUpcoming.length === 0 ? (
                                    <div className="muted">No upcoming owner bookings.</div>
                                ) : (
                                    <div className="dashboardScrollRow">
                                        {ownerUpcoming.map((booking) => {
                                            const { spot, title, address } = resolveBookingSpot(booking);
                                            const isPoints = booking.pay_method === "points";
                                            return (
                                                <SlotCard
                                                    key={booking.id}
                                                    tone="sage"
                                                    imageUrl={spot?.image_url}
                                                    title={title}
                                                    address={address}
                                                    amount={isPoints ? `+${booking.total_points ?? 0} pts` : `+${formatGbp(booking.total_price_gbp)}`}
                                                    badges={renderBadgeRow([{ label: "Upcoming", className: "badge badge--green" }])}
                                                    time={slotTime(booking.start_time, booking.end_time)}
                                                    actions={<Link to={`/spots/${booking.parking_spot_id}`} className="btn">View listing</Link>}
                                                />
                                            );
                                        })}
                                    </div>
                                )}
                        </DashboardDisclosureCard>
                    </div>
                </TabPanel>

                <TabPanel id="transactions" className="dashboardTabPanel" aria-busy={loading}>
                    <div className="dashboardDisclosureStack">
                        <DashboardDisclosureCard
                                tone="rewards"
                                title="Rewards History"
                                subtitle="Points earned and spent across the platform."
                                count={sortedRewards.length}
                                countClassName="badge badge--cool"
                            >
                            {sortedRewards.length === 0 ? (
                                <div className="muted">No reward activity yet.</div>
                            ) : (
                                <div className="dashboardChipRow dashboardChipRow--rewards">
                                    {sortedRewards.map((reward) => {
                                        const incoming = String(reward.type ?? "").toLowerCase() === "earn";
                                        const reason = reward.reason || "Reward";
                                        return (
                                            <div key={reward.id} className="dashboardChip dashboardRewardPill">
                                                <div className={`dashboardRewardAvatar${incoming ? " is-earn" : " is-spend"}`}>
                                                    {reason.slice(0, 1).toUpperCase()}
                                                </div>
                                                <div className="dashboardChipLeft">
                                                    <div className="dashboardChipTitle">{reason}</div>
                                                    <div className="tiny muted dashboardChipMeta">{formatDateTimeLocal(reward.created_at)}</div>
                                                </div>
                                                <div className="dashboardPillDivider" />
                                                <div className={`dashboardChipAmount ${incoming ? "dashboardChipAmount--in" : "dashboardChipAmount--out"}`}>
                                                    {incoming ? "+" : "-"}{reward.amount} pts
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                )}
                            </DashboardDisclosureCard>

                            <DashboardDisclosureCard
                                tone="payments"
                                title="Transaction History"
                                subtitle="Incoming and outgoing payment records."
                                count={payments.length}
                                countClassName="badge badge--green"
                            >
                            {payments.length === 0 ? (
                                <div className="muted">No payments yet.</div>
                            ) : (
                                <div className="dashboardRailRow dashboardRailRow--transactions">
                                    {payments.map((payment) => {
                                        const isOutgoing = payment.direction === "outgoing";
                                    const amountText = `${isOutgoing ? "-" : "+"}${formatGbp(payment.amount_gbp)}`;
                                        const statusText = capitalizeLabel(payment.status);
                                        const providerText = capitalizeLabel(payment.provider);
                                        return (
                                            <article key={payment.id} className="dashboardTxReceiptCard">
                                                <div className={`dashboardTxReceiptTop ${payment.direction === "incoming" ? "is-incoming" : "is-outgoing"}`}>
                                                    <div className={`dashboardTxAmount ${payment.direction === "incoming" ? "is-incoming" : "is-outgoing"}`}>{amountText}</div>
                                                    <div className="dashboardTxSpot">{payment.spot_title || "Parking spot"}</div>
                                                </div>
                                                <div className="dashboardTxDivider" />
                                                <div className="dashboardTxReceiptBottom">
                                                    <div className="dashboardTxMetaRow">
                                                        <span className="dashboardTxMetaLabel">Date</span>
                                                        <span className="dashboardTxMetaValue">{formatDateTimeLocal(payment.created_at)}</span>
                                                    </div>
                                                    <div className="dashboardTxMetaRow">
                                                        <span className="dashboardTxMetaLabel">Status</span>
                                                        <span className="dashboardTxMetaValue">{statusText}</span>
                                                    </div>
                                                    <div className="dashboardTxMetaRow">
                                                        <span className="dashboardTxMetaLabel">Via</span>
                                                        <span className="dashboardTxMetaValue">{providerText}</span>
                                                    </div>
                                                    <div className="dashboardTxLinks">
                                                        {isOutgoing ? (
                                                            <>
                                                                <button className="dashboardTxLink" onClick={() => openPaymentReceipt(payment.booking_id)} disabled={receiptLoadingId === payment.booking_id}>
                                                                    {receiptLoadingId === payment.booking_id ? "Loading..." : "Receipt >"}
                                                                </button>
                                                                <Link to={`/pay/${payment.booking_id}`} className="dashboardTxLink">Confirmation {">"}</Link>
                                                            </>
                                                        ) : (
                                                            <button className="dashboardTxLink" onClick={handleOpenConnectDashboard} disabled={connectBusy || !connect?.onboarding_complete || !!connect?.demo_bypass}>
                                                                Stripe dashboard {">"}
                                                            </button>
                                                        )}
                                                    </div>
                                                    {paymentReceiptErrors[payment.booking_id] && (
                                                        <div className="dashboardTxMetaValue">{paymentReceiptErrors[payment.booking_id]}</div>
                                                    )}
                                                </div>
                                            </article>
                                        );
                                    })}
                                </div>
                                )}
                            </DashboardDisclosureCard>

                            <DashboardDisclosureCard
                                tone="payments"
                                title="Stripe Account"
                                subtitle={connect?.demo_bypass ? "Demo payouts are simulated. No Stripe onboarding required." : "Connect Stripe to withdraw your earnings."}
                                count={connectLabel}
                                countClassName={connectBadgeClass}
                                isLast
                            >
                                <div ref={payoutsRef} className="stack">
                                    <div className="settingRow">
                                        <div className="settingRowTitle">
                                            <div className="tiny muted">Connected account</div>
                                            <div className="spotInfoValue">{connect?.demo_bypass ? "Demo simulation" : connect?.account_id ?? "Not connected"}</div>
                                        </div>
                                        <span className={connect?.charges_enabled ? "badge badge--green" : "badge badge--warm"}>{connect?.charges_enabled ? "Charges enabled" : "Charges pending"}</span>
                                    </div>

                                    <div className="settingRow">
                                        <div className="settingRowTitle">
                                            <div className="tiny muted">Payout capability</div>
                                            <div className="spotInfoValue">{connect?.payouts_enabled ? "Enabled" : "Pending"}</div>
                                        </div>
                                        <span className={connect?.details_submitted ? "badge badge--cool" : "badge badge--warm"}>{connect?.details_submitted ? "Details submitted" : "Details required"}</span>
                                    </div>

                                    <div className="rowInline">
                                        {connect?.demo_available && !connect?.demo_bypass && !connect?.account_id && (
                                            <button className="btn" onClick={() => handleBeginConnectOnboarding("demo")} disabled={connectBusy}>Use demo payouts</button>
                                        )}
                                        <button className="btn btn-primary" onClick={handleOpenConnectDashboard} disabled={connectBusy || !connect?.onboarding_complete || !!connect?.demo_bypass}>Open Stripe dashboard</button>
                                        <button className="btn" onClick={() => handleBeginConnectOnboarding("stripe")} disabled={connectBusy}>
                                            {connectBusy ? "Opening..." : connect?.demo_bypass ? "Connect Stripe instead" : !connect?.account_id ? "Connect Stripe" : connect.onboarding_complete ? "Update Stripe details" : "Continue onboarding"}
                                        </button>
                                        <button className="btn" onClick={handleRefreshConnectStatus} disabled={connectBusy}>Refresh status</button>
                                    </div>
                                </div>
                        </DashboardDisclosureCard>
                    </div>
                </TabPanel>
            </Tabs>
        </div>
    );
}

