export type ParkingSpot = {
    id: string;
    owner_user_id: string;
    title: string;
    description: string;

    mode: "free" | "rent" | "auction";
    price_gbp: number;
    price_unit?: "hour" | "day" | "week";
    auction_end?: string | null;
    auction_start_price_gbp?: number | null;
    auction_highest_pending_gbp?: number | null;
    auction_sold_out?: boolean;
    parking_type?: "private" | "public";
    capacity_total?: number;

    allow_points: boolean;
    points_cost: number;

    address_text: string;
    lat: number;
    lng: number;

    image_url: string | null;
    owner_contact_email?: string | null;
    owner_contact_phone?: string | null;
    owner_contact_info?: string | null;
    availability_json?: {
        type: "window_slots";
        windows?: Array<{
            mode?: "continuous";
            date_from: string;
            date_to: string;
            start: string;
            end: string;
        }>;
        parking_kind?: string;
    } | null;

    is_active: boolean;
    created_at: string;
    updated_at: string;
};

export type User = {
    id: string;
    email: string;
    name: string;
    points_balance: number;
    stripe_account_id?: string | null;
    stripe_charges_enabled?: boolean;
    stripe_payouts_enabled?: boolean;
    stripe_details_submitted?: boolean;
    created_at: string;
};

export type Booking = {
    id: string;
    parking_spot_id: string;
    driver_user_id: string;

    start_time: string;
    end_time: string;

    status: "pending" | "confirmed" | "cancelled";
    pay_method: "money" | "points";

    total_price_gbp: number;
    total_points?: number | null;
    owner_contact_email?: string | null;
    owner_contact_phone?: string | null;
    owner_contact_info?: string | null;

    created_at: string;
};

export type RewardTransaction = {
    id: string;
    user_id: string;
    type: "earn" | "spend";
    amount: number;
    reason: string;
    related_booking_id: string | null;
    related_spot_id: string | null;
    created_at: string;
};
