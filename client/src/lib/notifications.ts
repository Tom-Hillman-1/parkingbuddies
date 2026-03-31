import { useEffect, useMemo, useState } from "react";
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

type SeenNotificationCounts = Record<string, number>;

const NOTIFICATION_SEEN_STORAGE_KEY = "parkingbuddies.notification-seen";
const NOTIFICATION_SEEN_EVENT = "parkingbuddies:notification-seen";
const PERSISTENT_NOTIFICATION_IDS = new Set(["owner-pending-bids"]);

export const EMPTY_NOTIFICATION_SUMMARY: NotificationSummary = {
    total: 0,
    bySection: {
        manageBookings: 0,
        manageListings: 0,
        transactions: 0,
    },
    items: [],
};

function readSeenNotificationCounts(): SeenNotificationCounts {
    if (typeof window === "undefined") return {};

    try {
        const raw = window.localStorage.getItem(NOTIFICATION_SEEN_STORAGE_KEY);
        if (!raw) return {};

        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return {};

        return Object.fromEntries(
            Object.entries(parsed)
                .filter(([, value]) => Number.isFinite(value))
                .map(([key, value]) => [key, Math.max(0, Number(value))])
        );
    } catch {
        return {};
    }
}

function writeSeenNotificationCounts(next: SeenNotificationCounts) {
    if (typeof window === "undefined") return;

    try {
        window.localStorage.setItem(NOTIFICATION_SEEN_STORAGE_KEY, JSON.stringify(next));
        window.dispatchEvent(new Event(NOTIFICATION_SEEN_EVENT));
    } catch {
        // Ignore storage failures. Notifications still work; they just won't persist.
    }
}

function applySeenNotificationCounts(summary: NotificationSummary, seenCounts: SeenNotificationCounts): NotificationSummary {
    if (!summary.items.length) return summary;

    const items = summary.items
        .map((item) => {
            if (PERSISTENT_NOTIFICATION_IDS.has(item.id)) {
                return item;
            }
            const seenCount = Math.max(0, seenCounts[item.id] ?? 0);
            const count = Math.max(0, item.count - seenCount);
            return count > 0 ? { ...item, count } : null;
        })
        .filter((item): item is NotificationItem => Boolean(item));

    const bySection: Record<NotificationSection, number> = {
        manageBookings: 0,
        manageListings: 0,
        transactions: 0,
    };

    for (const item of items) {
        bySection[item.section] += item.count;
    }

    return {
        total: bySection.manageBookings + bySection.manageListings + bySection.transactions,
        bySection,
        items,
    };
}

export function markNotificationsSeen(items: NotificationItem[]) {
    if (!items.length) return;

    const seenCounts = readSeenNotificationCounts();
    let changed = false;

    for (const item of items) {
        if (PERSISTENT_NOTIFICATION_IDS.has(item.id)) continue;
        const seenCount = Math.max(0, seenCounts[item.id] ?? 0);
        if (item.count > seenCount) {
            seenCounts[item.id] = item.count;
            changed = true;
        }
    }

    if (changed) writeSeenNotificationCounts(seenCounts);
}

export function useSeenNotificationSummary(summary: NotificationSummary) {
    const [seenVersion, setSeenVersion] = useState(0);

    useEffect(() => {
        if (typeof window === "undefined") return undefined;

        const refreshSeenCounts = () => setSeenVersion((current) => current + 1);

        window.addEventListener(NOTIFICATION_SEEN_EVENT, refreshSeenCounts);
        window.addEventListener("storage", refreshSeenCounts);

        return () => {
            window.removeEventListener(NOTIFICATION_SEEN_EVENT, refreshSeenCounts);
            window.removeEventListener("storage", refreshSeenCounts);
        };
    }, []);

    return useMemo(
        () => applySeenNotificationCounts(summary, readSeenNotificationCounts()),
        [summary, seenVersion]
    );
}

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
