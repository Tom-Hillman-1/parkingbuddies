import { Router } from "express";
import { z } from "zod";
import { pool } from "../db";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { availabilityDateRange, isWindowSlot, parseUtcDateTime, remainingMinutes } from "../lib/availability";
import {
    LISTING_PUBLISH_REWARD_POINTS,
    MAX_LISTING_PUBLISH_REWARDS,
    MIN_POINTS_COST,
    toMoney,
    type PriceUnit,
} from "../lib/shared";
import { parseWithSchema } from "../lib/validation";
import { serverError } from "../lib/errors";
import { simpleRateLimit } from "../lib/rateLimit";
import { listingPayloadSchema, pointsPricingIssue, type ListingAvailability as AvailabilityJson, type ListingPayload, type Mode } from "../lib/listingSchemas";

const router = Router();

const MIN_AUCTION_START_PRICE_GBP = 0.1;
const DEMO_PAYOUTS_ENABLED = process.env.NODE_ENV !== "production" && ["1", "true", "yes", "on"].includes(
    String(process.env.DEMO_BYPASS_CONNECT ?? "").toLowerCase()
);
const DEMO_CONNECT_ACCOUNT_PREFIX = "acct_demo_";
const NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org";
const NOMINATIM_TIMEOUT_MS = 6000;
const NOMINATIM_HEADERS = {
    "Accept-Language": "en-GB,en;q=0.9",
    "User-Agent": "ParkingBuddies/1.0",
};
const geocodeRateLimit = simpleRateLimit({
    windowMs: 60 * 1000,
    max: 60,
    message: "Too many address lookups. Please wait a moment and try again.",
    keyPrefix: "geocode",
});
const createListingRateLimit = simpleRateLimit({
    windowMs: 60 * 60 * 1000,
    max: 6,
    message: "Too many listing publishes. Please wait a bit and try again.",
    keyPrefix: "listing_create",
});
const updateListingRateLimit = simpleRateLimit({
    windowMs: 60 * 60 * 1000,
    max: 18,
    message: "Too many listing edits. Please wait a bit and try again.",
    keyPrefix: "listing_update",
});
const deleteListingRateLimit = simpleRateLimit({
    windowMs: 60 * 60 * 1000,
    max: 8,
    message: "Too many listing removals. Please wait a bit and try again.",
    keyPrefix: "listing_delete",
});
const PUBLIC_SPOT_SELECT = `
    id,
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
    capacity_total,
    is_active,
    created_at,
    updated_at
`;
const spotIdParamsSchema = z.object({
    id: z.string().uuid("id must be a valid listing ID"),
});
const geocodeSearchQuerySchema = z.object({
    q: z.string().trim().min(3, "q must be at least 3 characters"),
    limit: z.coerce.number().int().min(1).max(12).optional(),
    countrycodes: z.string().trim().optional(),
    viewbox: z.string().trim().optional(),
});

type NormalizedListingInput = {
    title: string;
    description: string;
    mode: Mode;
    address_text: string;
    lat: number;
    lng: number;
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

type PreparedListingMutation = Omit<NormalizedListingInput, "priceNum" | "points_cost"> & {
    availability: AvailabilityJson;
    priceNum: number;
    pointsCost: number;
    auction_end: string | null;
    auction_start_price_gbp: number | null;
};

function isDateYYYYMMDD(x: unknown): x is string {
    return typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x);
}

function isDemoConnectAccountId(accountId: string | null | undefined) {
    return typeof accountId === "string" && accountId.startsWith(DEMO_CONNECT_ACCOUNT_PREFIX);
}

function ownerOnboardingComplete(ownerConnect: any) {
    return (
        (DEMO_PAYOUTS_ENABLED && !ownerConnect?.stripe_account_id) ||
        isDemoConnectAccountId(ownerConnect?.stripe_account_id) ||
        (typeof ownerConnect?.stripe_account_id === "string" &&
            ownerConnect.stripe_charges_enabled &&
            ownerConnect.stripe_payouts_enabled &&
            ownerConnect.stripe_details_submitted)
    );
}

function listingNeedsMoneyPayout(data: PreparedListingMutation) {
    if (data.mode === "rent") return data.priceNum > 0;
    if (data.mode === "auction") return Number(data.auction_start_price_gbp ?? 0) > 0;
    return false;
}

function auctionEndFromAvailability(availability: AvailabilityJson) {
    if (!Array.isArray(availability.windows) || availability.windows.length === 0) return null;
    const lastDate = availability.windows
        .map((window: AvailabilityJson["windows"][number]) => (isDateYYYYMMDD(window.date_to) ? window.date_to : null))
        .filter((value: string | null): value is string => Boolean(value))
        .sort()
        .at(-1);
    if (!lastDate) return null;
    return new Date(parseUtcDateTime(lastDate, "23:59").getTime() + 59 * 1000 + 999).toISOString();
}

function buildAvailabilityJson(body: ListingPayload): { ok: true; availability: AvailabilityJson } {
    const features = Array.isArray(body.availability.features) ? body.availability.features : [];
    const featureField = features.length ? { features } : { features: [] };

    const windows = body.availability.windows
        .filter((rawWindow: ListingPayload["availability"]["windows"][number]) => isWindowSlot(rawWindow))
        .map((rawWindow: ListingPayload["availability"]["windows"][number]) => ({
            mode: "continuous" as const,
            date_from: rawWindow.date_from,
            date_to: rawWindow.date_to,
            start: rawWindow.start,
            end: rawWindow.end,
        }));

    return { ok: true, availability: { type: "window_slots", windows, ...featureField } };
}

function normalizeListingInput(
    body: ListingPayload,
): { ok: true; data: NormalizedListingInput } | { ok: false; error: string } {
    const allow_points = body.allow_points;
    const points_cost = body.points_cost;
    if (allow_points && body.mode !== "rent" && body.mode !== "auction") {
        return { ok: false, error: "Points can only be enabled for rent or auction listings" };
    }
    const pricingIssue = pointsPricingIssue(allow_points, points_cost);
    if (pricingIssue) {
        return { ok: false, error: pricingIssue };
    }

    return {
        ok: true,
        data: {
            title: body.title,
            description: body.description,
            mode: body.mode,
            address_text: body.address_text,
            lat: body.lat,
            lng: body.lng,
            capacity_total: body.capacity_total,
            image_url: body.image_url,
            unit: body.price_unit,
            priceNum: toMoney(body.price_gbp),
            allow_points,
            points_cost,
            owner_contact_email: body.owner_contact_email,
            owner_contact_phone: body.owner_contact_phone,
            owner_contact_info: body.owner_contact_info,
        },
    };
}

function resolveListingPricing(
    body: ListingPayload,
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
        const ap = toMoney(body.auction_start_price_gbp);
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
        priceNum = 0;
    }

    if (mode === "free") priceNum = 0;
    if (mode === "rent" && priceNum <= 0 && !allowPoints) {
        return { ok: false, error: "rent mode requires price_gbp > 0" };
    }
    if (allowPoints && pointsCost < MIN_POINTS_COST) {
        return { ok: false, error: "points_cost must be >= 1 when allow_points is true" };
    }

    return { ok: true, data: { priceNum, pointsCost, auction_end, auction_start_price_gbp } };
}

function prepareListingMutation(
    body: ListingPayload
): { ok: true; data: PreparedListingMutation } | { ok: false; error: string } {
    const parsedInput = normalizeListingInput(body);
    if (!parsedInput.ok) {
        return parsedInput;
    }

    const availabilityResult = buildAvailabilityJson(body);

    const pricingResult = resolveListingPricing(
        body,
        parsedInput.data.mode,
        availabilityResult.availability,
        parsedInput.data.priceNum,
        parsedInput.data.allow_points,
        parsedInput.data.points_cost
    );
    if (!pricingResult.ok) {
        return pricingResult;
    }

    const { points_cost: _ignoredPointsCost, ...normalizedInput } = parsedInput.data;
    return {
        ok: true,
        data: {
            ...normalizedInput,
            availability: availabilityResult.availability,
            ...pricingResult.data,
        },
    };
}

function listingMutationCoreValues(data: PreparedListingMutation) {
    return [
        data.title,
        data.description,
        data.mode,
        data.priceNum,
        data.unit,
        data.allow_points,
        data.pointsCost,
        data.address_text,
        data.lat,
        data.lng,
        data.image_url,
        data.availability,
        data.auction_end,
        data.auction_start_price_gbp,
        data.capacity_total,
        data.owner_contact_email,
        data.owner_contact_phone,
        data.owner_contact_info,
    ];
}

async function fetchNominatim(params: URLSearchParams) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), NOMINATIM_TIMEOUT_MS);
    try {
        return await fetch(`${NOMINATIM_BASE_URL}/search?${params.toString()}`, {
            headers: NOMINATIM_HEADERS,
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timeout);
    }
}

router.post("/", requireAuth, createListingRateLimit, async (req: AuthRequest, res) => {
    const parsedBody = parseWithSchema(listingPayloadSchema, req.body ?? {}, res, "listing_create");
    if (!parsedBody.ok) return;
    const body = parsedBody.data;
    const prepared = prepareListingMutation(body);
    if (!prepared.ok) return res.status(400).json({ ok: false, error: prepared.error });

    if (listingNeedsMoneyPayout(prepared.data)) {
        try {
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
            if (!ownerOnboardingComplete(ownerConnectR.rows[0])) {
                return res.status(400).json({
                    ok: false,
                    error: "Complete Stripe onboarding in Settings before publishing a listing with money payments.",
                });
            }
        } catch (e) {
            return serverError(res, e, "Unable to publish listing right now");
        }
    }
    const insertValues = [req.userId, ...listingMutationCoreValues(prepared.data)];

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
        capacity_total,
        owner_contact_email,
        owner_contact_phone,
        owner_contact_info
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
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
        return serverError(res, e, "Unable to publish listing right now");
    } finally {
        client.release();
    }
});

router.patch("/:id", requireAuth, updateListingRateLimit, async (req: AuthRequest, res) => {
    const parsedParams = parseWithSchema(spotIdParamsSchema, req.params ?? {}, res, "listing_update");
    if (!parsedParams.ok) return;
    const parsedBody = parseWithSchema(listingPayloadSchema, req.body ?? {}, res, "listing_update");
    if (!parsedBody.ok) return;
    const body = parsedBody.data;
    const spotId = parsedParams.data.id;
    const prepared = prepareListingMutation(body);
    if (!prepared.ok) return res.status(400).json({ ok: false, error: prepared.error });
    const updateValues = [...listingMutationCoreValues(prepared.data), spotId, req.userId];

    try {
        if (listingNeedsMoneyPayout(prepared.data)) {
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
            if (!ownerOnboardingComplete(ownerConnectR.rows[0])) {
                return res.status(400).json({
                    ok: false,
                    error: "Complete Stripe onboarding in Settings before publishing a listing with money payments.",
                });
            }
        }

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
           auction_end=$13,
           auction_start_price_gbp=$14,
           capacity_total=$15,
           owner_contact_email=$16,
           owner_contact_phone=$17,
           owner_contact_info=$18,
           updated_at=now()
       WHERE id=$19 AND owner_user_id=$20 AND is_active = true
       RETURNING *`,
            updateValues
        );

        if (!r.rowCount) {
            return res.status(404).json({ ok: false, error: "Parking spot not found, inactive, or not owned by user" });
        }

        return res.json({ ok: true, parking_spot: r.rows[0] });
    } catch (e) {
        return serverError(res, e, "Unable to update listing right now");
    }
});

router.delete("/:id", requireAuth, deleteListingRateLimit, async (req: AuthRequest, res) => {
    const parsedParams = parseWithSchema(spotIdParamsSchema, req.params ?? {}, res, "listing_delete");
    if (!parsedParams.ok) return;
    const spotId = parsedParams.data.id;
    const userId = req.userId;

    try {
        const ownedSpot = await pool.query(
            `UPDATE parking_spots
             SET is_active = false,
                 updated_at = now()
             WHERE id = $1 AND owner_user_id = $2 AND is_active = true
             RETURNING id, title`,
            [spotId, userId]
        );

        if (!ownedSpot.rowCount) {
            return res.status(404).json({ ok: false, error: "Parking spot not found, already deleted, or not owned by user" });
        }

        return res.json({ ok: true, deleted: true, parking_spot: ownedSpot.rows[0] });
    } catch (e) {
        return serverError(res, e, "Unable to delete listing right now");
    }
});

router.get("/", async (_req, res) => {
    try {
        const r = await pool.query(
            `SELECT ${PUBLIC_SPOT_SELECT}
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
                const amt = toMoney(b.amount_gbp);
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

        return res.json({ ok: true, parking_spots: spots });
    } catch (e) {
        return serverError(res, e, "Unable to load listings right now");
    }
});

router.get("/geocode/search", geocodeRateLimit, async (req, res) => {
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

        const response = await fetchNominatim(params);
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
                   .slice(0, maxResults)
            : [];

        return res.json({ ok: true, suggestions });
    } catch (e) {
        return res.status(503).json({ ok: false, error: "Address search is unavailable right now. Please try again." });
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
        return serverError(res, e, "Unable to load owner contact right now");
    }
});

router.get("/:id", async (req, res) => {
    const parsedParams = parseWithSchema(spotIdParamsSchema, req.params ?? {}, res, "listing_get");
    if (!parsedParams.ok) return;
    try {
        const r = await pool.query(
            `SELECT ${PUBLIC_SPOT_SELECT}
       FROM parking_spots
       WHERE id = $1
         AND is_active = true`,
            [parsedParams.data.id]
        );

        if (!r.rowCount) {
            return res.status(404).json({ ok: false, error: "Parking spot not found" });
        }

        return res.json({ ok: true, parking_spot: r.rows[0] });
    } catch (e) {
        return serverError(res, e, "Unable to load listing right now");
    }
});

export default router;


