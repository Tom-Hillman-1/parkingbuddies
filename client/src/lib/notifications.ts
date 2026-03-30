import { useQuery } from "@tanstack/react-query";
import type { ConnectStatus } from "./auth";
import { apiGet } from "./api";
import type { Booking as SharedBooking, ParkingSpot, User } from "../types";

export type NotificationSection = "manageBookings" | "manageListings" | "transactions";

type Booking = SharedBooking & {
    owner_user_id?: string;
    payment_status?: string | null;
};

type AuctionBid = {
    status?: string | null;
};

type DashboardNotificationInputs = {
    bookings: Booking[];
    myListings: ParkingSpot[];
    auctionBids: AuctionBid[];
    myAuctionBids: AuctionBid[];
    connect: ConnectStatus | null;
};

export type NotificationItem = {
    id: string;
    section: NotificationSection;
    label: string;
    count: number;
    href: string;
};

export type NotificationSummary = {
    total: number;
    bySection: Record<NotificationSection, number>;
    items: NotificationItem[];
};

export const EMPTY_NOTIFICATION_SUMMARY: NotificationSummary = {
    total: 0,
    bySection: {
        manageBookings: 0,
        manageListings: 0,
        transactions: 0,
    },
    items: [],
};

function isPendingBid(bid: AuctionBid) {
    return String(bid.status ?? "").toLowerCase() === "pending";
}

function bookingStillNeedsPayment(booking: Booking) {
    if (booking.pay_method !== "money") return false;
    if (Number(booking.total_price_gbp ?? 0) <= 0) return false;
    const bookingStatus = String(booking.status ?? "").toLowerCase();
    const paymentStatus = String(booking.payment_status ?? "").toLowerCase();
    return bookingStatus === "pending" && paymentStatus !== "succeeded";
}

export function summarizeNotifications(input: DashboardNotificationInputs): NotificationSummary {
    const pendingBookingPayments = input.bookings.filter(bookingStillNeedsPayment).length;
    const pendingMyBids = input.myAuctionBids.filter(isPendingBid).length;
    const pendingOwnerBids = input.auctionBids.filter(isPendingBid).length;
    const hasPublishedListings = input.myListings.length > 0;
    // The Stripe reminder only matters once someone is actually trying to host.
    const needsPayoutSetup =
        hasPublishedListings &&
        !input.connect?.demo_bypass &&
        (!input.connect?.account_id || !input.connect.onboarding_complete || !input.connect.payouts_enabled);

    const bySection = {
        manageBookings: pendingBookingPayments + pendingMyBids,
        manageListings: pendingOwnerBids,
        transactions: needsPayoutSetup ? 1 : 0,
    } satisfies Record<NotificationSection, number>;

    const items: NotificationItem[] = [];
    if (pendingBookingPayments > 0) {
        items.push({
            id: "booking-payments",
            section: "manageBookings",
            label: "payment needed",
            count: pendingBookingPayments,
            href: "/dashboard?tab=myBookings",
        });
    }
    if (pendingMyBids > 0) {
        items.push({
            id: "my-pending-bids",
            section: "manageBookings",
            label: "bids awaiting review",
            count: pendingMyBids,
            href: "/dashboard?tab=myAuctionBids",
        });
    }
    if (pendingOwnerBids > 0) {
        items.push({
            id: "owner-pending-bids",
            section: "manageListings",
            label: "owner decisions",
            count: pendingOwnerBids,
            href: "/dashboard?tab=ownerPending",
        });
    }
    if (needsPayoutSetup) {
        items.push({
            id: "stripe-payouts",
            section: "transactions",
            label: "payout setup",
            count: 1,
            href: "/dashboard?tab=payouts",
        });
    }

    return {
        total: bySection.manageBookings + bySection.manageListings + bySection.transactions,
        bySection,
        items,
    };
}

export function useNotificationSummary(token: string | null) {
    return useQuery<NotificationSummary>({
        queryKey: ["notification-summary", token],
        enabled: Boolean(token),
        staleTime: 5000,
        queryFn: async () => {
            if (!token) return EMPTY_NOTIFICATION_SUMMARY;

            const connectPromise = apiGet<{ connect: ConnectStatus }>("/payments/connect/status", token)
                .then((response) => response.connect ?? null)
                .catch(() => null);

            const [meRes, bookingsRes, spotsRes, bidsRes, myBidsRes, connect] = await Promise.all([
                apiGet<{ user: User }>("/me", token),
                apiGet<{ bookings: Booking[] }>("/bookings/me", token),
                apiGet<{ parking_spots: ParkingSpot[] }>("/parking-spots"),
                apiGet<{ bids: AuctionBid[] }>("/auctions/owner/bids", token),
                apiGet<{ bids: AuctionBid[] }>("/auctions/me/pending", token),
                connectPromise,
            ]);

            const me = meRes.user;
            const allSpots = spotsRes.parking_spots ?? [];
            const myListings = allSpots.filter((spot) => spot.owner_user_id === me.id);

            return summarizeNotifications({
                bookings: bookingsRes.bookings ?? [],
                myListings,
                auctionBids: bidsRes.bids ?? [],
                myAuctionBids: myBidsRes.bids ?? [],
                connect,
            });
        },
    });
}
