import { Router } from "express";
import { pool } from "../db";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { availabilityDateRange, isWindowSlot, normalizeExcludeDows, remainingMinutes } from "../lib/availability";

const router = Router();

const LISTING_REWARD_POINTS = 1;
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
const LEGACY_SPOT_COLUMN_MARKERS = [
    "parking_type",
    "capacity_total",
    "capacity_available",
    "auction_end",
    "auction_start_price_gbp",
    "owner_contact_email",
    "owner_contact_phone",
    "owner_contact_info",
];

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

type AvailabilityJson =
    | { type: "24_7"; date_from?: string; date_to?: string; parking_kind?: ParkingKind }
    | { type: "same_everyday"; start: string; end: string; date_from?: string; date_to?: string; parking_kind?: ParkingKind }
    | {
          type: "custom_weekly";
          rules: Array<{ dow: number; start: string; end: string }>;
          date_from?: string;
          date_to?: string;
          parking_kind?: ParkingKind;
      }
    | {
          type: "window_slots";
          windows: Array<{
              mode: "continuous" | "split";
              date_from: string;
              date_to: string;
              start: string;
              end: string;
              exclude_dows?: number[];
          }>;
          parking_kind?: ParkingKind;
      };

type LegacyAvailabilityType = "24_7" | "weekly";
type NormalizedListingInput = {
    title: string;
    description: string;
    mode: Mode;
    address_text: string;
    lat: number;
    lng: number;
    parking_type: ParkingType;
    capacity_total: number;
    capacity_available: number;
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

function isTimeHHMM(x: unknown): x is string {
    return typeof x === "string" && /^\d{2}:\d{2}$/.test(x);
}
function isDateYYYYMMDD(x: unknown): x is string {
    return typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x);
}

function minutes(hhmm: string) {
    const [rawH, rawM] = hhmm.split(":");
    const h = Number(rawH ?? 0);
    const m = Number(rawM ?? 0);
    return h * 60 + m;
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

function isLegacySpotColumnError(message: string) {
    return LEGACY_SPOT_COLUMN_MARKERS.some((marker) => message.includes(marker));
}

function auctionEndFromAvailability(availability: AvailabilityJson) {
    if (availability.type === "window_slots") {
        if (!Array.isArray(availability.windows) || availability.windows.length === 0) return null;
        const lastDate = availability.windows
            .map((window) => (isDateYYYYMMDD(window.date_to) ? window.date_to : null))
            .filter((value): value is string => Boolean(value))
            .sort()
            .at(-1);
        if (!lastDate) return null;
        return new Date(`${lastDate}T23:59:59.999Z`).toISOString();
    }

    const dateTo = availability.date_to;
    if (!isDateYYYYMMDD(dateTo)) return null;
    return new Date(`${dateTo}T23:59:59.999Z`).toISOString();
}

let auctionSchemaReady = false;
async function ensureAuctionBidSchema() {
    if (auctionSchemaReady) return;
    try {
        await pool.query(
            `ALTER TABLE auction_bids
             ADD COLUMN IF NOT EXISTS start_time timestamptz,
             ADD COLUMN IF NOT EXISTS end_time timestamptz`
        );
        auctionSchemaReady = true;
    } catch {
    }
}

let ownerContactSchemaReady = false;
async function ensureOwnerContactSchema() {
    if (ownerContactSchemaReady) return;
    await pool.query(
        `ALTER TABLE parking_spots
         ADD COLUMN IF NOT EXISTS owner_contact_email text,
         ADD COLUMN IF NOT EXISTS owner_contact_phone text,
         ADD COLUMN IF NOT EXISTS owner_contact_info text`
    );
    ownerContactSchemaReady = true;
}

function buildAvailabilityJson(body: any): { ok: true; availability: AvailabilityJson } | { ok: false; error: string } {
    const a = body?.availability;
    const date_from = isDateYYYYMMDD(a?.date_from) ? a.date_from : undefined;
    const date_to = isDateYYYYMMDD(a?.date_to) ? a.date_to : undefined;
    const parking_kind = parseParkingKind(body?.parking_kind ?? a?.parking_kind) ?? undefined;
    const kindField = parking_kind ? { parking_kind } : {};
    if (date_from && date_to && date_from > date_to) {
        return { ok: false, error: "availability.date_from must be before availability.date_to" };
    }
    if (a && typeof a === "object") {
        if (a.type === "24_7") return { ok: true, availability: { type: "24_7", date_from, date_to, ...kindField } };

        if (a.type === "same_everyday") {
            if (!isTimeHHMM(a.start) || !isTimeHHMM(a.end)) {
                return { ok: false, error: "availability.start/end must be HH:MM" };
            }
            if (minutes(a.start) >= minutes(a.end)) {
                return { ok: false, error: "availability.start must be before availability.end" };
            }
            return {
                ok: true,
                availability: { type: "same_everyday", start: a.start, end: a.end, date_from, date_to, ...kindField },
            };
        }

        if (a.type === "custom_weekly") {
            if (!Array.isArray(a.rules) || a.rules.length === 0) {
                return { ok: false, error: "availability.rules must be a non-empty array" };
            }
            const rules = a.rules.map((r: any) => ({
                dow: Number(r?.dow),
                start: r?.start,
                end: r?.end,
            }));

            for (const r of rules) {
                if (!Number.isInteger(r.dow) || r.dow < 0 || r.dow > 6) {
                    return { ok: false, error: "availability.rules.dow must be 0..6" };
                }
                if (!isTimeHHMM(r.start) || !isTimeHHMM(r.end)) {
                    return { ok: false, error: "availability.rules.start/end must be HH:MM" };
                }
                if (minutes(r.start) >= minutes(r.end)) {
                    return { ok: false, error: "availability rule start must be before end" };
                }
            }

            return { ok: true, availability: { type: "custom_weekly", rules, date_from, date_to, ...kindField } };
        }

        if (a.type === "window_slots") {
            if (!Array.isArray(a.windows) || a.windows.length === 0) {
                return { ok: false, error: "availability.windows must be a non-empty array" };
            }

            const windows = [];
            for (const rawWindow of a.windows) {
                if (!isWindowSlot(rawWindow)) {
                    return { ok: false, error: "Each availability window needs valid mode, dates, and times" };
                }
                windows.push({
                    mode: rawWindow.mode,
                    date_from: rawWindow.date_from,
                    date_to: rawWindow.date_to,
                    start: rawWindow.start,
                    end: rawWindow.end,
                    exclude_dows: rawWindow.mode === "split" ? normalizeExcludeDows(rawWindow.exclude_dows) : [],
                });
            }

            return { ok: true, availability: { type: "window_slots", windows, ...kindField } };
        }

        return { ok: false, error: "Invalid availability.type" };
    }
    const legacyType = (body?.availability_type ?? "24_7") as LegacyAvailabilityType;
    if (legacyType === "24_7") {
        return { ok: true, availability: { type: "24_7", ...kindField } };
    }

    if (legacyType === "weekly") {
        const daysRaw = body?.available_days;
        const ds = body?.daily_start;
        const de = body?.daily_end;

        if (!Array.isArray(daysRaw) || daysRaw.length === 0) {
            return { ok: false, error: "available_days is required for weekly availability" };
        }
        if (!isTimeHHMM(ds) || !isTimeHHMM(de)) {
            return { ok: false, error: "daily_start and daily_end must be HH:MM" };
        }
        if (minutes(ds) >= minutes(de)) {
            return { ok: false, error: "daily_start must be before daily_end" };
        }

        const parsedDays = daysRaw.map((d: any) => Number(d)).filter((n: number) => Number.isInteger(n));
        if (parsedDays.length !== daysRaw.length || !parsedDays.every((n: number) => n >= 0 && n <= 6)) {
            return { ok: false, error: "available_days must be integers 0..6" };
        }
        return {
            ok: true,
            availability: {
                type: "custom_weekly",
                rules: parsedDays.map((dow: number) => ({ dow, start: ds, end: de })),
                ...kindField,
            },
        };
    }

    return { ok: false, error: "Invalid availability_type" };
}

function normalizeListingInput(
    body: any,
    options?: { enforceCapacityAvailableLimit?: boolean }
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
    const capacity_available = safeInt(body?.capacity_available || capacity_total || 1);
    if (parking_type === "public" && capacity_total <= 0) {
        return { ok: false, error: "capacity_total must be > 0 for public parking" };
    }
    if (options?.enforceCapacityAvailableLimit && capacity_available > capacity_total) {
        return { ok: false, error: "capacity_available cannot exceed capacity_total" };
    }

    const allow_points = isBool(body?.allow_points) ? body.allow_points : false;
    const points_cost = safeInt(body?.points_cost);
    if (allow_points && mode !== "rent" && mode !== "auction") {
        return { ok: false, error: "Points can only be enabled for rent or auction listings" };
    }
    if (allow_points && points_cost < MIN_POINTS_COST) {
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
            capacity_available,
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
    allowPoints: boolean
): { ok: true; data: { priceNum: number; auction_end: string | null; auction_start_price_gbp: number | null } } | { ok: false; error: string } {
    let priceNum = initialPriceNum;
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
        priceNum = 0;
    }

    if (mode === "free") priceNum = 0;
    if (mode === "rent" && priceNum <= 0 && !allowPoints) {
        return { ok: false, error: "rent mode requires price_gbp > 0" };
    }

    return { ok: true, data: { priceNum, auction_end, auction_start_price_gbp } };
}

router.post("/", requireAuth, async (req: AuthRequest, res) => {
    await ensureOwnerContactSchema();
    const body = req.body ?? {};
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
        capacity_available,
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

    const pricing = resolveListingPricing(body, mode, av.availability, initialPriceNum, allow_points);
    if (!pricing.ok) return res.status(400).json({ ok: false, error: pricing.error });
    const { priceNum, auction_end, auction_start_price_gbp } = pricing.data;
    const insertValues = [
        req.userId,
        title,
        description,
        mode,
        priceNum,
        unit,
        allow_points,
        points_cost,
        address_text,
        lat,
        lng,
        image_url,
        av.availability,
        auction_end,
        auction_start_price_gbp,
        parking_type,
        capacity_total,
        capacity_available,
        owner_contact_email,
        owner_contact_phone,
        owner_contact_info,
    ];
    const legacyInsertValues = insertValues.slice(0, 13);

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await client.query("SAVEPOINT insert_spot");

        let spot: any;
        try {
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
        capacity_available,
        owner_contact_email,
        owner_contact_phone,
        owner_contact_info
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
      )
      RETURNING *`,
                insertValues
            );
            spot = r.rows[0];
        } catch (e: any) {
            const msg = String(e?.message || e);
            if (isLegacySpotColumnError(msg)) {
                await client.query("ROLLBACK TO SAVEPOINT insert_spot");
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
          availability_json
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
        )
        RETURNING *`,
                    legacyInsertValues
                );
                spot = r.rows[0];
            } else {
                throw e;
            }
        }
        await client.query("RELEASE SAVEPOINT insert_spot");
        await client.query(
            `UPDATE users
       SET points_balance = points_balance + $1, updated_at = now()
       WHERE id = $2`,
            [LISTING_REWARD_POINTS, req.userId]
        );

        await client.query(
            `INSERT INTO reward_transactions (user_id, type, amount, reason, related_spot_id)
       VALUES ($1,'earn',$2,'listing_upload',$3)`,
            [req.userId, LISTING_REWARD_POINTS, spot.id]
        );

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
    await ensureOwnerContactSchema();
    const body = req.body ?? {};
    const spotId = req.params.id;
    const parsedInput = normalizeListingInput(body, { enforceCapacityAvailableLimit: true });
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
        capacity_available,
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

    const pricing = resolveListingPricing(body, mode, av.availability, initialPriceNum, allow_points);
    if (!pricing.ok) return res.status(400).json({ ok: false, error: pricing.error });
    const { priceNum, auction_end, auction_start_price_gbp } = pricing.data;
    const updateBaseValues = [
        title,
        description,
        mode,
        priceNum,
        unit,
        allow_points,
        points_cost,
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
        capacity_available,
        spotId,
        req.userId,
    ];
    const legacyUpdateValues = [...updateBaseValues.slice(0, 12), spotId, req.userId];

    try {
        let r;
        try {
            r = await pool.query(
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
           capacity_available=$20,
           updated_at=now()
       WHERE id=$21 AND owner_user_id=$22
       RETURNING *`,
                updateValues
            );
        } catch (e: any) {
            const msg = String(e?.message || e);
            if (isLegacySpotColumnError(msg)) {
                r = await pool.query(
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
               updated_at=now()
            WHERE id=$13 AND owner_user_id=$14
            RETURNING *`,
                    legacyUpdateValues
                );
            } else {
                throw e;
            }
        }

        if (!r.rowCount) {
            return res.status(404).json({ ok: false, error: "Parking spot not found or not owned by user" });
        }

        return res.json({ ok: true, parking_spot: r.rows[0] });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

router.delete("/:id", requireAuth, async (req: AuthRequest, res) => {
    const spotId = req.params.id;
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
        await client.query(
            `UPDATE reward_transactions
             SET related_spot_id = NULL
             WHERE related_spot_id = $1`,
            [spotId]
        );
        const bookingIdsRes = await client.query(
            `SELECT id FROM bookings WHERE parking_spot_id = $1`,
            [spotId]
        );
        const bookingIds = bookingIdsRes.rows.map((r: { id: string }) => r.id);
        if (bookingIds.length > 0) {
            await client.query(
                `DELETE FROM payments
                 WHERE booking_id = ANY($1::uuid[])`,
                [bookingIds]
            );
        }

        await client.query(
            `DELETE FROM bookings
             WHERE parking_spot_id = $1`,
            [spotId]
        );
        try {
            await client.query(
                `DELETE FROM auction_bids
                 WHERE parking_spot_id = $1`,
                [spotId]
            );
        } catch {
        }

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
        await ensureAuctionBidSchema();
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
    const rawQuery = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (rawQuery.length < 3) {
        return res.status(400).json({ ok: false, error: "q must be at least 3 characters" });
    }

    const limitRaw = Number(req.query.limit ?? 12);
    const limit = Number.isFinite(limitRaw) ? Math.min(12, Math.max(1, Math.floor(limitRaw))) : 12;
    const countrycodes =
        typeof req.query.countrycodes === "string" && req.query.countrycodes.trim()
            ? req.query.countrycodes.trim()
            : "gb";
    const viewbox =
        typeof req.query.viewbox === "string" && req.query.viewbox.trim()
            ? req.query.viewbox.trim()
            : "-0.5103,51.6919,0.3340,51.2868";

    try {
        const params = new URLSearchParams({
            format: "jsonv2",
            limit: String(limit),
            addressdetails: "1",
            countrycodes,
            viewbox,
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
    const latRaw = typeof req.query.lat === "string" ? Number(req.query.lat) : Number.NaN;
    const lngRaw = typeof req.query.lng === "string" ? Number(req.query.lng) : Number.NaN;

    if (!Number.isFinite(latRaw) || !Number.isFinite(lngRaw)) {
        return res.status(400).json({ ok: false, error: "lat and lng query params are required" });
    }
    if (latRaw < -90 || latRaw > 90 || lngRaw < -180 || lngRaw > 180) {
        return res.status(400).json({ ok: false, error: "lat/lng out of range" });
    }

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
    try {
        await ensureOwnerContactSchema();
        const r = await pool.query(
            `SELECT owner_contact_email, owner_contact_phone, owner_contact_info
             FROM parking_spots
             WHERE id = $1 AND owner_user_id = $2`,
            [req.params.id, req.userId]
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
    try {
        const r = await pool.query(
            `SELECT *
       FROM parking_spots
       WHERE id = $1`,
            [req.params.id]
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

