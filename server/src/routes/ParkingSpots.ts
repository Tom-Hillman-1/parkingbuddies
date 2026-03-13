import { Router } from "express";
import { z } from "zod";
import { pool } from "../db";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { availabilityDateRange, isWindowSlot, remainingMinutes } from "../lib/availability";
import {
    derivedPointsCostFromMoney,
    LISTING_PUBLISH_REWARD_POINTS,
    MAX_LISTING_PUBLISH_REWARDS,
} from "../lib/shared";
import { parseWithSchema } from "../lib/validation";

const router = Router();

const MIN_AUCTION_START_PRICE_GBP = 0.1;
const MIN_POINTS_COST = 1;
const DEMO_PAYOUTS_ENABLED = ["1", "true", "yes", "on"].includes(
    String(process.env.DEMO_BYPASS_CONNECT ?? "").toLowerCase()
);
const DEMO_CONNECT_ACCOUNT_PREFIX = "acct_demo_";
const NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org";
const NOMINATIM_HEADERS = {
    "Accept-Language": "en-GB,en;q=0.9",
    "User-Agent": "ParkingBuddies/1.0",
};
const listingBodySchema = z.record(z.string(), z.unknown());
const spotIdParamsSchema = z.object({
    id: z.string().uuid("id must be a valid listing ID"),
});
const geocodeSearchQuerySchema = z.object({
    q: z.string().trim().min(3, "q must be at least 3 characters"),
    limit: z.coerce.number().int().min(1).max(12).optional(),
    countrycodes: z.string().trim().optional(),
    viewbox: z.string().trim().optional(),
});
const geocodeReverseQuerySchema = z.object({
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
});

type PriceUnit = "hour" | "day" | "week";
type Mode = "free" | "rent" | "auction";
type ParkingType = "private" | "public";
type ParkingKind =
    | "street"
    | "parking_lot"
    | "garage"
    | "closed_parking"
    | "driveway"
    | "underground"
    | "carport"
    | "multi_storey"
    | "ev_charging";

type AvailabilityJson = {
    type: "window_slots";
    windows: Array<{
        mode: "continuous";
        date_from: string;
        date_to: string;
        start: string;
        end: string;
    }>;
    parking_kind?: ParkingKind;
};

type NormalizedListingInput = {
    title: string;
    description: string;
    mode: Mode;
    address_text: string;
    lat: number;
    lng: number;
    parking_type: ParkingType;
    capacity_total: number;
    image_url: string | null;
    unit: PriceUnit;
    priceNum: number;
    allow_points: boolean;
    points_cost: number;
    owner_contact_email: string | null;
    owner_contact_phone: string | null;
    owner_contact_info: string | null;
};

function isNonEmptyString(x: unknown, minLen = 1): x is string {
    return typeof x === "string" && x.trim().length >= minLen;
}

function isBool(x: unknown): x is boolean {
    return typeof x === "boolean";
}

function isNumber(x: unknown): x is number {
    return typeof x === "number" && Number.isFinite(x);
}

function isDateYYYYMMDD(x: unknown): x is string {
    return typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x);
}

function parseMode(x: unknown): Mode | null {
    if (x === "free" || x === "rent" || x === "auction") return x;
    return null;
}

function parseParkingType(x: unknown): ParkingType | null {
    if (x === "private" || x === "public") return x;
    return null;
}

function parseParkingKind(x: unknown): ParkingKind | null {
    if (
        x === "street" ||
        x === "parking_lot" ||
        x === "garage" ||
        x === "closed_parking" ||
        x === "driveway" ||
        x === "underground" ||
        x === "carport" ||
        x === "multi_storey" ||
        x === "ev_charging"
    ) {
        return x;
    }
    if (x === "covered_parking") return "closed_parking";
    return null;
}

function parsePriceUnit(x: unknown): PriceUnit | null {
    if (x === "hour" || x === "day" || x === "week") return x;
    return null;
}

function safeMoney(x: unknown) {
    const n = Number(x ?? 0);
    return Number.isFinite(n) && n >= 0 ? n : 0;
}

function safeInt(x: unknown) {
    const n = Number(x ?? 0);
    return Number.isFinite(n) ? Math.floor(n) : 0;
}

function optionalTrimmedText(x: unknown, maxLength = 240) {
    if (typeof x !== "string") return null;
    const trimmed = x.trim();
    if (!trimmed) return null;
    return trimmed.slice(0, maxLength);
}

function stripPrivateOwnerContact(spot: any) {
    if (!spot || typeof spot !== "object") return spot;
    const { owner_contact_email, owner_contact_phone, owner_contact_info, ...publicSpot } = spot;
    return publicSpot;
}

function isDemoConnectAccountId(accountId: string | null | undefined) {
    return typeof accountId === "string" && accountId.startsWith(DEMO_CONNECT_ACCOUNT_PREFIX);
}

function auctionEndFromAvailability(availability: AvailabilityJson) {
    if (!Array.isArray(availability.windows) || availability.windows.length === 0) return null;
    const lastDate = availability.windows
        .map((window) => (isDateYYYYMMDD(window.date_to) ? window.date_to : null))
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1);
    if (!lastDate) return null;
    return new Date(`${lastDate}T23:59:59.999Z`).toISOString();
}

function buildAvailabilityJson(body: any): { ok: true; availability: AvailabilityJson } | { ok: false; error: string } {
    const a = body?.availability;
    const parking_kind = parseParkingKind(body?.parking_kind ?? a?.parking_kind) ?? undefined;
    const kindField = parking_kind ? { parking_kind } : {};
    if (a?.type !== "window_slots" || !Array.isArray(a.windows) || a.windows.length === 0) {
        return { ok: false, error: "availability.windows must be a non-empty array" };
    }

    const windows = [];
    for (const rawWindow of a.windows) {
        if (!isWindowSlot(rawWindow)) {
            return { ok: false, error: "Each availability window needs valid dates and times" };
        }
        windows.push({
            mode: "continuous" as const,
            date_from: rawWindow.date_from,
            date_to: rawWindow.date_to,
            start: rawWindow.start,
            end: rawWindow.end,
        });
    }

    return { ok: true, availability: { type: "window_slots", windows, ...kindField } };
}

function normalizeListingInput(
    body: any,
): { ok: true; data: NormalizedListingInput } | { ok: false; error: string } {
    const titleRaw = body?.title;
    const descriptionRaw = body?.description;
    const mode = parseMode(body?.mode);
    const addressRaw = body?.address_text;
    const lat = body?.lat;
    const lng = body?.lng;

    if (!isNonEmptyString(titleRaw, 3) || !isNonEmptyString(descriptionRaw, 5) || !mode) {
        return { ok: false, error: "Missing or invalid title/description/mode" };
    }
    if (!isNonEmptyString(addressRaw, 5) || !isNumber(lat) || !isNumber(lng)) {
        return { ok: false, error: "Missing or invalid address/lat/lng" };
    }

    const parking_type = parseParkingType(body?.parking_type) ?? "private";
    const capacity_total = safeInt(body?.capacity_total || 1);
    if (parking_type === "public" && capacity_total <= 0) {
        return { ok: false, error: "capacity_total must be > 0 for public parking" };
    }

    const allow_points = isBool(body?.allow_points) ? body.allow_points : false;
    const points_cost = safeInt(body?.points_cost);
    if (allow_points && mode !== "rent" && mode !== "auction") {
        return { ok: false, error: "Points can only be enabled for rent or auction listings" };
    }
    const moneyPriceForValidation = mode === "auction" ? safeMoney(body?.auction_start_price_gbp) : safeMoney(body?.price_gbp);
    if (allow_points && points_cost < MIN_POINTS_COST && moneyPriceForValidation <= 0) {
        return { ok: false, error: "points_cost must be >= 1 when allow_points is true" };
    }

    const owner_contact_email = optionalTrimmedText(body?.owner_contact_email, 160);
    const owner_contact_phone = optionalTrimmedText(body?.owner_contact_phone, 60);
    const owner_contact_info = optionalTrimmedText(body?.owner_contact_info, 500);

    return {
        ok: true,
        data: {
            title: titleRaw.trim(),
            description: descriptionRaw.trim(),
            mode,
            address_text: addressRaw.trim(),
            lat,
            lng,
            parking_type,
            capacity_total,
            image_url: body?.image_url ?? null,
            unit: parsePriceUnit(body?.price_unit) ?? "hour",
            priceNum: safeMoney(body?.price_gbp),
            allow_points,
            points_cost,
            owner_contact_email,
            owner_contact_phone,
            owner_contact_info,
        },
    };
}

function resolveListingPricing(
    body: any,
    mode: Mode,
    availability: AvailabilityJson,
    initialPriceNum: number,
    allowPoints: boolean,
    requestedPointsCost: number
): { ok: true; data: { priceNum: number; pointsCost: number; auction_end: string | null; auction_start_price_gbp: number | null } } | { ok: false; error: string } {
    let priceNum = initialPriceNum;
    let pointsCost = allowPoints ? requestedPointsCost : 0;
    let auction_end: string | null = null;
    let auction_start_price_gbp: number | null = null;

    if (mode === "auction") {
        const ap = safeMoney(body?.auction_start_price_gbp);
        const hasMoneyPricing = ap >= MIN_AUCTION_START_PRICE_GBP;
        if (!hasMoneyPricing && !allowPoints) {
            return { ok: false, error: "Auction listings need money pricing or points enabled" };
        }

        const { dateFrom, dateTo } = availabilityDateRange(availability);
        if (!dateFrom || !dateTo) {
            return { ok: false, error: "Auction listings must include availability date range" };
        }

        auction_end = auctionEndFromAvailability(availability);
        if (!auction_end) {
            return { ok: false, error: "Auction listings need a valid end date" };
        }

        auction_start_price_gbp = hasMoneyPricing ? ap : null;
        pointsCost = allowPoints && auction_start_price_gbp ? derivedPointsCostFromMoney(auction_start_price_gbp) : pointsCost;
        priceNum = 0;
    }

    if (mode === "free") priceNum = 0;
    if (mode === "rent" && priceNum <= 0 && !allowPoints) {
        return { ok: false, error: "rent mode requires price_gbp > 0" };
    }
    if (mode === "rent" && allowPoints && priceNum > 0) {
        pointsCost = derivedPointsCostFromMoney(priceNum);
    }
    if (allowPoints && pointsCost < MIN_POINTS_COST) {
        return { ok: false, error: "points_cost must be >= 1 when allow_points is true" };
    }

    return { ok: true, data: { priceNum, pointsCost, auction_end, auction_start_price_gbp } };
}

router.post("/", requireAuth, async (req: AuthRequest, res) => {
    const parsedBody = parseWithSchema(listingBodySchema, req.body ?? {}, res, "listing_create");
    if (!parsedBody.ok) return;
    const body = parsedBody.data;
    const parsedInput = normalizeListingInput(body);
    if (!parsedInput.ok) return res.status(400).json({ ok: false, error: parsedInput.error });
    const {
        title,
        description,
        mode,
        address_text,
        lat,
        lng,
        parking_type,
        capacity_total,
        image_url,
        unit,
        priceNum: initialPriceNum,
        allow_points,
        points_cost,
        owner_contact_email,
        owner_contact_phone,
        owner_contact_info,
    } = parsedInput.data;

    const ownerConnectR = await pool.query(
        `SELECT stripe_account_id,
                stripe_charges_enabled,
                stripe_payouts_enabled,
                stripe_details_submitted
         FROM users
         WHERE id = $1`,
        [req.userId]
    );
    if (!ownerConnectR.rowCount) {
        return res.status(404).json({ ok: false, error: "User not found" });
    }
    const ownerConnect = ownerConnectR.rows[0];
    const onboardingComplete =
        (DEMO_PAYOUTS_ENABLED && !ownerConnect.stripe_account_id) ||
        isDemoConnectAccountId(ownerConnect.stripe_account_id) ||
        (typeof ownerConnect.stripe_account_id === "string" &&
            ownerConnect.stripe_charges_enabled &&
            ownerConnect.stripe_payouts_enabled &&
            ownerConnect.stripe_details_submitted);
    if (!onboardingComplete) {
        return res.status(400).json({
            ok: false,
            error: "Complete Stripe onboarding in Settings before publishing a listing.",
        });
    }
    const av = buildAvailabilityJson(body);
    if (!av.ok) return res.status(400).json({ ok: false, error: av.error });

    const pricing = resolveListingPricing(body, mode, av.availability, initialPriceNum, allow_points, points_cost);
    if (!pricing.ok) return res.status(400).json({ ok: false, error: pricing.error });
    const { priceNum, pointsCost, auction_end, auction_start_price_gbp } = pricing.data;
    const insertValues = [
        req.userId,
        title,
        description,
        mode,
        priceNum,
        unit,
        allow_points,
        pointsCost,
        address_text,
        lat,
        lng,
        image_url,
        av.availability,
        auction_end,
        auction_start_price_gbp,
        parking_type,
        capacity_total,
        owner_contact_email,
        owner_contact_phone,
        owner_contact_info,
    ];

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const r = await client.query(
            `INSERT INTO parking_spots (
        owner_user_id,
        title,
        description,
        mode,
        price_gbp,
        price_unit,
        allow_points,
        points_cost,
        address_text,
        lat,
        lng,
        image_url,
        availability_json,
        auction_end,
        auction_start_price_gbp,
        parking_type,
        capacity_total,
        owner_contact_email,
        owner_contact_phone,
        owner_contact_info
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
      )
      RETURNING *`,
            insertValues
        );
        const spot = r.rows[0];
        const listingRewardCountR = await client.query(
            `SELECT COUNT(*)::int AS reward_count
             FROM reward_transactions
             WHERE user_id = $1
               AND reason = 'listing_publish_bonus'`,
            [req.userId]
        );
        const listingRewardCount = Number(listingRewardCountR.rows[0]?.reward_count ?? 0);
        if (listingRewardCount < MAX_LISTING_PUBLISH_REWARDS) {
            await client.query(
                `UPDATE users
                 SET points_balance = points_balance + $1, updated_at = now()
                 WHERE id = $2`,
                [LISTING_PUBLISH_REWARD_POINTS, req.userId]
            );
            await client.query(
                `INSERT INTO reward_transactions (user_id, type, amount, reason, related_spot_id)
                 VALUES ($1, 'earn', $2, 'listing_publish_bonus', $3)`,
                [req.userId, LISTING_PUBLISH_REWARD_POINTS, spot.id]
            );
            spot.owner_listing_bonus_points = LISTING_PUBLISH_REWARD_POINTS;
        }
        await client.query("COMMIT");
        return res.status(201).json({ ok: true, parking_spot: spot });
    } catch (e) {
        await client.query("ROLLBACK");
        return res.status(500).json({ ok: false, error: String(e) });
    } finally {
        client.release();
    }
});

router.patch("/:id", requireAuth, async (req: AuthRequest, res) => {
    const parsedParams = parseWithSchema(spotIdParamsSchema, req.params ?? {}, res, "listing_update");
    if (!parsedParams.ok) return;
    const parsedBody = parseWithSchema(listingBodySchema, req.body ?? {}, res, "listing_update");
    if (!parsedBody.ok) return;
    const body = parsedBody.data;
    const spotId = parsedParams.data.id;
    const parsedInput = normalizeListingInput(body);
    if (!parsedInput.ok) return res.status(400).json({ ok: false, error: parsedInput.error });
    const {
        title,
        description,
        mode,
        address_text,
        lat,
        lng,
        parking_type,
        capacity_total,
        image_url,
        unit,
        priceNum: initialPriceNum,
        allow_points,
        points_cost,
        owner_contact_email,
        owner_contact_phone,
        owner_contact_info,
    } = parsedInput.data;

    const av = buildAvailabilityJson(body);
    if (!av.ok) return res.status(400).json({ ok: false, error: av.error });

    const pricing = resolveListingPricing(body, mode, av.availability, initialPriceNum, allow_points, points_cost);
    if (!pricing.ok) return res.status(400).json({ ok: false, error: pricing.error });
    const { priceNum, pointsCost, auction_end, auction_start_price_gbp } = pricing.data;
    const updateBaseValues = [
        title,
        description,
        mode,
        priceNum,
        unit,
        allow_points,
        pointsCost,
        address_text,
        lat,
        lng,
        image_url,
        av.availability,
        owner_contact_email,
        owner_contact_phone,
        owner_contact_info,
    ];
    const updateValues = [
        ...updateBaseValues,
        auction_end,
        auction_start_price_gbp,
        parking_type,
        capacity_total,
        spotId,
        req.userId,
    ];

    try {
        const r = await pool.query(
            `UPDATE parking_spots
       SET title=$1,
           description=$2,
           mode=$3,
           price_gbp=$4,
           price_unit=$5,
           allow_points=$6,
           points_cost=$7,
           address_text=$8,
           lat=$9,
           lng=$10,
           image_url=$11,
           availability_json=$12,
           owner_contact_email=$13,
           owner_contact_phone=$14,
           owner_contact_info=$15,
           auction_end=$16,
           auction_start_price_gbp=$17,
           parking_type=$18,
           capacity_total=$19,
           updated_at=now()
       WHERE id=$20 AND owner_user_id=$21
       RETURNING *`,
            updateValues
        );

        if (!r.rowCount) {
            return res.status(404).json({ ok: false, error: "Parking spot not found or not owned by user" });
        }

        return res.json({ ok: true, parking_spot: r.rows[0] });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

router.delete("/:id", requireAuth, async (req: AuthRequest, res) => {
    const parsedParams = parseWithSchema(spotIdParamsSchema, req.params ?? {}, res, "listing_delete");
    if (!parsedParams.ok) return;
    const spotId = parsedParams.data.id;
    const userId = req.userId;

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const ownedSpot = await client.query(
            `SELECT id, title
             FROM parking_spots
             WHERE id = $1 AND owner_user_id = $2`,
            [spotId, userId]
        );

        if (!ownedSpot.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ ok: false, error: "Parking spot not found or not owned by user" });
        }
        const activityR = await client.query(
            `SELECT
                 EXISTS(SELECT 1 FROM bookings WHERE parking_spot_id = $1) AS has_bookings,
                 EXISTS(
                     SELECT 1
                     FROM payments p
                     JOIN bookings b ON b.id = p.booking_id
                     WHERE b.parking_spot_id = $1
                 ) AS has_payments,
                 EXISTS(SELECT 1 FROM auction_bids WHERE parking_spot_id = $1) AS has_bids`,
            [spotId]
        );
        const activity = activityR.rows[0] as {
            has_bookings?: boolean;
            has_payments?: boolean;
            has_bids?: boolean;
        };
        if (activity?.has_bookings || activity?.has_payments || activity?.has_bids) {
            await client.query("ROLLBACK");
            return res.status(400).json({
                ok: false,
                error: "This listing has booking or bidding history and cannot be deleted.",
            });
        }
        await client.query(
            `UPDATE reward_transactions
             SET related_spot_id = NULL
             WHERE related_spot_id = $1`,
            [spotId]
        );

        await client.query(
            `DELETE FROM parking_spots
             WHERE id = $1 AND owner_user_id = $2`,
            [spotId, userId]
        );

        await client.query("COMMIT");
        return res.json({ ok: true, deleted: true, parking_spot: ownedSpot.rows[0] });
    } catch (e) {
        await client.query("ROLLBACK");
        return res.status(500).json({ ok: false, error: String(e) });
    } finally {
        client.release();
    }
});

router.get("/", async (_req, res) => {
    try {
        const r = await pool.query(
            `SELECT *
       FROM parking_spots
       WHERE is_active = true
       ORDER BY created_at DESC`
        );
        const spots = r.rows ?? [];
        const auctionIds = spots.filter((s: any) => s.mode === "auction").map((s: any) => s.id);

        if (auctionIds.length) {
            const bidsR = await pool.query(
                `SELECT parking_spot_id, amount_gbp, status, start_time, end_time
                 FROM auction_bids
                 WHERE parking_spot_id = ANY($1)`,
                [auctionIds]
            );

            const highestPending = new Map<string, number>();
            const approvedBySpot = new Map<string, Array<{ start: Date; end: Date }>>();

            for (const b of bidsR.rows) {
                const spotId = b.parking_spot_id as string;
                const amt = safeMoney(b.amount_gbp);
                if (b.status === "pending") {
                    const prev = highestPending.get(spotId) ?? 0;
                    if (amt > prev) highestPending.set(spotId, amt);
                }
                if (b.status === "accepted" && b.start_time && b.end_time) {
                    const arr = approvedBySpot.get(spotId) ?? [];
                    arr.push({ start: new Date(b.start_time), end: new Date(b.end_time) });
                    approvedBySpot.set(spotId, arr);
                }
            }

            for (const s of spots) {
                if (s.mode !== "auction") continue;
                const hp = highestPending.get(s.id) ?? 0;
                const approved = approvedBySpot.get(s.id) ?? [];
                const remaining = remainingMinutes(s, approved);
                s.auction_highest_pending_gbp = hp;
                s.auction_sold_out = remaining < 16;
            }
        }

        return res.json({ ok: true, parking_spots: spots.map(stripPrivateOwnerContact) });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

router.get("/geocode/search", async (req, res) => {
    const parsedQuery = parseWithSchema(geocodeSearchQuerySchema, req.query ?? {}, res, "geocode_search");
    if (!parsedQuery.ok) return;
    const { q, limit, countrycodes, viewbox } = parsedQuery.data;
    const rawQuery = q;
    const maxResults = limit ?? 12;
    const regionCodes = countrycodes || "gb";
    const searchViewbox = viewbox || "-0.5103,51.6919,0.3340,51.2868";

    try {
        const params = new URLSearchParams({
            format: "jsonv2",
            limit: String(maxResults),
            addressdetails: "1",
            countrycodes: regionCodes,
            viewbox: searchViewbox,
            q: rawQuery,
        });

        const response = await fetch(`${NOMINATIM_BASE_URL}/search?${params.toString()}`, {
            headers: NOMINATIM_HEADERS,
        });
        if (!response.ok) {
            return res.status(502).json({ ok: false, error: `Address search provider error (${response.status})` });
        }

        const payload = (await response.json()) as Array<{
            place_id?: number;
            display_name?: string;
            lat?: string;
            lon?: string;
        }>;
        const suggestions = Array.isArray(payload)
            ? payload
                  .filter((item) => typeof item.display_name === "string" && typeof item.lat === "string" && typeof item.lon === "string")
                  .map((item) => ({
                      place_id: Number(item.place_id ?? 0),
                      display_name: item.display_name as string,
                      lat: item.lat as string,
                      lon: item.lon as string,
                  }))
                  .slice(0, 5)
            : [];

        return res.json({ ok: true, suggestions });
    } catch (e) {
        return res.status(503).json({ ok: false, error: "Address search is unavailable right now. Please try again." });
    }
});

router.get("/geocode/reverse", async (req, res) => {
    const parsedQuery = parseWithSchema(geocodeReverseQuerySchema, req.query ?? {}, res, "geocode_reverse");
    if (!parsedQuery.ok) return;
    const { lat: latRaw, lng: lngRaw } = parsedQuery.data;

    try {
        const params = new URLSearchParams({
            format: "jsonv2",
            addressdetails: "1",
            lat: String(latRaw),
            lon: String(lngRaw),
            zoom: "18",
        });

        const response = await fetch(`${NOMINATIM_BASE_URL}/reverse?${params.toString()}`, {
            headers: NOMINATIM_HEADERS,
        });
        if (!response.ok) {
            return res.status(502).json({ ok: false, error: `Address lookup provider error (${response.status})` });
        }

        const payload = (await response.json()) as {
            display_name?: string;
            lat?: string;
            lon?: string;
        };
        if (typeof payload.display_name !== "string") {
            return res.status(404).json({ ok: false, error: "No nearby address found" });
        }

        return res.json({
            ok: true,
            result: {
                display_name: payload.display_name,
                lat: typeof payload.lat === "string" ? payload.lat : String(latRaw),
                lon: typeof payload.lon === "string" ? payload.lon : String(lngRaw),
            },
        });
    } catch {
        return res.status(503).json({ ok: false, error: "Address lookup is unavailable right now. Please try again." });
    }
});

router.get("/:id/owner-contact", requireAuth, async (req: AuthRequest, res) => {
    const parsedParams = parseWithSchema(spotIdParamsSchema, req.params ?? {}, res, "listing_owner_contact");
    if (!parsedParams.ok) return;
    try {
        const r = await pool.query(
            `SELECT owner_contact_email, owner_contact_phone, owner_contact_info
             FROM parking_spots
             WHERE id = $1 AND owner_user_id = $2`,
            [parsedParams.data.id, req.userId]
        );
        if (!r.rowCount) {
            return res.status(404).json({ ok: false, error: "Parking spot not found or not owned by user" });
        }
        return res.json({ ok: true, owner_contact: r.rows[0] });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

router.get("/:id", async (req, res) => {
    const parsedParams = parseWithSchema(spotIdParamsSchema, req.params ?? {}, res, "listing_get");
    if (!parsedParams.ok) return;
    try {
        const r = await pool.query(
            `SELECT *
       FROM parking_spots
       WHERE id = $1`,
            [parsedParams.data.id]
        );

        if (!r.rowCount) {
            return res.status(404).json({ ok: false, error: "Parking spot not found" });
        }

        return res.json({ ok: true, parking_spot: stripPrivateOwnerContact(r.rows[0]) });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

export default router;

