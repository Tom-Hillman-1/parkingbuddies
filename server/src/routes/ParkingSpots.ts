import { Router } from "express";
import { pool } from "../db";
import { requireAuth, AuthRequest } from "../middleware/auth";

const router = Router();

// reward amount for uploading a listing (PDD #8)
const LISTING_REWARD_POINTS = 5;
const IMAGE_REWARD_POINTS = 2;
const MIN_AUCTION_START_PRICE_GBP = 0.1;
const MIN_POINTS_COST = 1;
const NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org";
const NOMINATIM_HEADERS = {
    "Accept-Language": "en-GB,en;q=0.9",
    "User-Agent": "ParkingBuddies/1.0",
};

type PriceUnit = "hour" | "day" | "week";
type Mode = "free" | "rent" | "auction";
type ParkingType = "private" | "public";

// New availability JSON shapes (supports your improved UI)
type AvailabilityJson =
    | { type: "24_7"; date_from?: string; date_to?: string }
    | { type: "same_everyday"; start: string; end: string; date_from?: string; date_to?: string }
    | { type: "custom_weekly"; rules: Array<{ dow: number; start: string; end: string }>; date_from?: string; date_to?: string };

// Legacy (old) availability (your earlier phase-2 code)
type LegacyAvailabilityType = "24_7" | "weekly";

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
    const [h, m] = hhmm.split(":").map(Number);
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
        // ignore
    }
}

function extractAvailabilityRules(spot: any) {
    const rules: Array<{ dow: number; start: string; end: string }> = [];
    const a = spot?.availability_json;

    if (a?.type === "24_7") {
        return Array.from({ length: 7 }).map((_, dow) => ({ dow, start: "00:00", end: "23:59" }));
    }
    if (a?.type === "same_everyday" && a.start && a.end) {
        return Array.from({ length: 7 }).map((_, dow) => ({ dow, start: a.start, end: a.end }));
    }
    if (a?.type === "custom_weekly" && Array.isArray(a.rules)) {
        return a.rules.slice();
    }

    if (spot?.availability_type === "24_7") {
        return Array.from({ length: 7 }).map((_, dow) => ({ dow, start: "00:00", end: "23:59" }));
    }
    if (spot?.availability_type === "weekly" && Array.isArray(spot?.available_days)) {
        const ds = spot?.daily_start?.slice(0, 5) ?? "00:00";
        const de = spot?.daily_end?.slice(0, 5) ?? "23:59";
        return spot.available_days.map((dow: number) => ({ dow, start: ds, end: de }));
    }
    return rules;
}

function setTime(d: Date, hhmm: string) {
    const [h, m] = hhmm.split(":").map((x) => Number(x));
    const out = new Date(d);
    out.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
    return out;
}

function buildAvailabilityWindows(spot: any, maxDaysForward = 30) {
    const rules = extractAvailabilityRules(spot);
    if (!rules.length) return [];

    const a: any = spot?.availability_json;
    const dateFrom = a?.date_from ? new Date(`${a.date_from}T00:00:00`) : null;
    const dateTo = a?.date_to ? new Date(`${a.date_to}T23:59:59`) : null;

    const now = new Date();
    const maxEnd = new Date(now.getTime() + maxDaysForward * 24 * 60 * 60 * 1000);
    const startDay = dateFrom && dateFrom > now ? new Date(dateFrom) : new Date(now);
    startDay.setHours(0, 0, 0, 0);

    const hardEnd = dateTo && dateTo < maxEnd ? new Date(dateTo) : maxEnd;
    hardEnd.setHours(23, 59, 59, 999);

    const windows: Array<{ start: Date; end: Date }> = [];
    for (let d = new Date(startDay); d <= hardEnd; d.setDate(d.getDate() + 1)) {
        const day = new Date(d);
        const dow = day.getDay();
        const dayRules = rules.filter((r) => r.dow === dow);
        for (const r of dayRules) {
            const start = setTime(day, r.start);
            const end = setTime(day, r.end);
            if (end <= now) continue;
            windows.push({ start, end });
        }
    }
    return windows;
}

function subtractBookings(
    window: { start: Date; end: Date },
    bookings: Array<{ start: Date; end: Date }>
) {
    let segments: Array<{ start: Date; end: Date }> = [{ ...window }];
    for (const b of bookings) {
        if (b.end <= window.start || b.start >= window.end) continue;
        const next: Array<{ start: Date; end: Date }> = [];
        for (const seg of segments) {
            if (b.end <= seg.start || b.start >= seg.end) {
                next.push(seg);
            } else {
                if (b.start > seg.start) next.push({ start: seg.start, end: b.start });
                if (b.end < seg.end) next.push({ start: b.end, end: seg.end });
            }
        }
        segments = next;
    }
    return segments;
}

function remainingMinutes(spot: any, approved: Array<{ start: Date; end: Date }>) {
    const windows = buildAvailabilityWindows(spot, 30);
    let total = 0;
    for (const w of windows) {
        const segments = subtractBookings(w, approved);
        for (const s of segments) {
            total += Math.max(0, (s.end.getTime() - s.start.getTime()) / 60000);
        }
    }
    return total;
}

/**
 * Accepts:
 * - NEW: req.body.availability (object)
 * - OLD: availability_type + available_days + daily_start + daily_end
 *
 * Returns availability_json for storage in parking_spots.availability_json
 */
function buildAvailabilityJson(body: any): { ok: true; availability: AvailabilityJson } | { ok: false; error: string } {
    const a = body?.availability;
    const date_from = isDateYYYYMMDD(a?.date_from) ? a.date_from : undefined;
    const date_to = isDateYYYYMMDD(a?.date_to) ? a.date_to : undefined;
    if (date_from && date_to && date_from > date_to) {
        return { ok: false, error: "availability.date_from must be before availability.date_to" };
    }

    // ✅ New format (preferred)
    if (a && typeof a === "object") {
        if (a.type === "24_7") return { ok: true, availability: { type: "24_7", date_from, date_to } };

        if (a.type === "same_everyday") {
            if (!isTimeHHMM(a.start) || !isTimeHHMM(a.end)) {
                return { ok: false, error: "availability.start/end must be HH:MM" };
            }
            if (minutes(a.start) >= minutes(a.end)) {
                return { ok: false, error: "availability.start must be before availability.end" };
            }
            return { ok: true, availability: { type: "same_everyday", start: a.start, end: a.end, date_from, date_to } };
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

            return { ok: true, availability: { type: "custom_weekly", rules, date_from, date_to } };
        }

        return { ok: false, error: "Invalid availability.type" };
    }

    // ✅ Old format fallback (keeps backwards compatibility)
    const legacyType = (body?.availability_type ?? "24_7") as LegacyAvailabilityType;
    if (legacyType === "24_7") {
        return { ok: true, availability: { type: "24_7" } };
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

        // Convert weekly to custom_weekly rules (one rule per day)
        return {
            ok: true,
            availability: { type: "custom_weekly", rules: parsedDays.map((dow: number) => ({ dow, start: ds, end: de })) },
        };
    }

    return { ok: false, error: "Invalid availability_type" };
}

/**
 * POST /parking-spots
 * Creates a parking spot
 * + rewards user for listing contribution
 *
 * Supports:
 * - pricing unit (hour/day/week)
 * - availability_json (24/7, same everyday, custom weekly)
 * - auction fields stored (booking disabled for auction in bookings.ts)
 */
router.post("/", requireAuth, async (req: AuthRequest, res) => {
    const body = req.body ?? {};

    const title = body.title;
    const description = body.description;
    const mode = parseMode(body.mode);

    const address_text = body.address_text;
    const lat = body.lat;
    const lng = body.lng;
    const parking_type = parseParkingType(body.parking_type) ?? "private";
    const capacity_total = safeInt(body.capacity_total || 1);
    const capacity_available = safeInt(body.capacity_available || capacity_total || 1);

    const image_url = body.image_url ?? null; // can be URL or base64 data URL

    // Validate required basics
    if (!isNonEmptyString(title, 3) || !isNonEmptyString(description, 5) || !mode) {
        return res.status(400).json({ ok: false, error: "Missing or invalid title/description/mode" });
    }
    if (!isNonEmptyString(address_text, 5) || !isNumber(lat) || !isNumber(lng)) {
        return res.status(400).json({ ok: false, error: "Missing or invalid address/lat/lng" });
    }
    if (parking_type === "public" && capacity_total <= 0) {
        return res.status(400).json({ ok: false, error: "capacity_total must be > 0 for public parking" });
    }

    // pricing config
    const unit = parsePriceUnit(body.price_unit) ?? "hour";
    let priceNum = safeMoney(body.price_gbp);

    // points config
    const allow_points = isBool(body.allow_points) ? body.allow_points : false;
    const points_cost = safeInt(body.points_cost);
    if (allow_points && mode !== "rent" && mode !== "auction") {
        return res.status(400).json({ ok: false, error: "Points can only be enabled for rent or auction listings" });
    }
    if (allow_points && points_cost < MIN_POINTS_COST) {
        return res.status(400).json({ ok: false, error: "points_cost must be >= 1 when allow_points is true" });
    }

    // availability (new or old)
    const av = buildAvailabilityJson(body);
    if (!av.ok) return res.status(400).json({ ok: false, error: av.error });

    // Auction validation (store fields; booking is blocked in bookings.ts)
    let auction_end: string | null = null;
    let auction_start_price_gbp: number | null = null;

    if (mode === "auction") {
        const ap = safeMoney(body.auction_start_price_gbp);
        if (ap < MIN_AUCTION_START_PRICE_GBP) {
            return res.status(400).json({ ok: false, error: "auction_start_price_gbp must be >= 0.1 for auction" });
        }

        const endRaw = body.auction_end;
        if (typeof endRaw !== "string" || Number.isNaN(Date.parse(endRaw))) {
            return res.status(400).json({ ok: false, error: "auction_end must be a valid ISO datetime for auction" });
        }

        auction_start_price_gbp = ap;
        auction_end = new Date(endRaw).toISOString();

        // auction listings do NOT use price_gbp as rent price
        priceNum = 0;

        // require date range for auction listings
        const av = buildAvailabilityJson(body);
        if (!av.ok) return res.status(400).json({ ok: false, error: av.error });
        const dateFrom = (av as any).availability?.date_from;
        const dateTo = (av as any).availability?.date_to;
        if (!dateFrom || !dateTo) {
            return res.status(400).json({ ok: false, error: "Auction listings must include availability date range" });
        }
    }

    // Free forces price=0
    if (mode === "free") priceNum = 0;

    // Rent must be > 0
    if (mode === "rent" && priceNum <= 0) {
        return res.status(400).json({ ok: false, error: "rent mode requires price_gbp > 0" });
    }

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
        capacity_available
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
      )
      RETURNING *`,
                [
                    req.userId,
                    title.trim(),
                    description.trim(),
                    mode,
                    priceNum,
                    unit,
                    allow_points,
                    points_cost,
                    address_text.trim(),
                    lat,
                    lng,
                    image_url,
                    av.availability,
                    auction_end,
                    auction_start_price_gbp,
                    parking_type,
                    capacity_total,
                    capacity_available,
                ]
            );
            spot = r.rows[0];
        } catch (e: any) {
            const msg = String(e?.message || e);
            // Fallback for older DBs that don't have newer columns yet
            if (
                msg.includes("parking_type") ||
                msg.includes("capacity_total") ||
                msg.includes("capacity_available") ||
                msg.includes("auction_end") ||
                msg.includes("auction_start_price_gbp")
            ) {
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
                    [
                        req.userId,
                        title.trim(),
                        description.trim(),
                        mode,
                        priceNum,
                        unit,
                        allow_points,
                        points_cost,
                        address_text.trim(),
                        lat,
                        lng,
                        image_url,
                        av.availability,
                    ]
                );
                spot = r.rows[0];
            } else {
                throw e;
            }
        }
        await client.query("RELEASE SAVEPOINT insert_spot");

        // reward listing creation
        const totalReward = LISTING_REWARD_POINTS + (image_url ? IMAGE_REWARD_POINTS : 0);
        await client.query(
            `UPDATE users
       SET points_balance = points_balance + $1, updated_at = now()
       WHERE id = $2`,
            [totalReward, req.userId]
        );

        await client.query(
            `INSERT INTO reward_transactions (user_id, type, amount, reason, related_spot_id)
       VALUES ($1,'earn',$2,'listing_upload',$3)`,
            [req.userId, LISTING_REWARD_POINTS, spot.id]
        );
        if (image_url) {
            await client.query(
                `INSERT INTO reward_transactions (user_id, type, amount, reason, related_spot_id)
         VALUES ($1,'earn',$2,'listing_photo',$3)`,
                [req.userId, IMAGE_REWARD_POINTS, spot.id]
            );
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

/**
 * PATCH /parking-spots/:id
 * Updates a parking spot (owner only)
 */
router.patch("/:id", requireAuth, async (req: AuthRequest, res) => {
    const body = req.body ?? {};
    const spotId = req.params.id;

    const title = body.title;
    const description = body.description;
    const mode = parseMode(body.mode);

    const address_text = body.address_text;
    const lat = body.lat;
    const lng = body.lng;
    const parking_type = parseParkingType(body.parking_type) ?? "private";
    const capacity_total = safeInt(body.capacity_total || 1);
    const capacity_available = safeInt(body.capacity_available || capacity_total || 1);

    const image_url = body.image_url ?? null;

    if (!isNonEmptyString(title, 3) || !isNonEmptyString(description, 5) || !mode) {
        return res.status(400).json({ ok: false, error: "Missing or invalid title/description/mode" });
    }
    if (!isNonEmptyString(address_text, 5) || !isNumber(lat) || !isNumber(lng)) {
        return res.status(400).json({ ok: false, error: "Missing or invalid address/lat/lng" });
    }
    if (parking_type === "public" && capacity_total <= 0) {
        return res.status(400).json({ ok: false, error: "capacity_total must be > 0 for public parking" });
    }
    if (capacity_available > capacity_total) {
        return res.status(400).json({ ok: false, error: "capacity_available cannot exceed capacity_total" });
    }

    const unit = parsePriceUnit(body.price_unit) ?? "hour";
    let priceNum = safeMoney(body.price_gbp);

    const allow_points = isBool(body.allow_points) ? body.allow_points : false;
    const points_cost = safeInt(body.points_cost);
    if (allow_points && mode !== "rent" && mode !== "auction") {
        return res.status(400).json({ ok: false, error: "Points can only be enabled for rent or auction listings" });
    }
    if (allow_points && points_cost < MIN_POINTS_COST) {
        return res.status(400).json({ ok: false, error: "points_cost must be >= 1 when allow_points is true" });
    }

    const av = buildAvailabilityJson(body);
    if (!av.ok) return res.status(400).json({ ok: false, error: av.error });

    let auction_end: string | null = null;
    let auction_start_price_gbp: number | null = null;

    if (mode === "auction") {
        const ap = safeMoney(body.auction_start_price_gbp);
        if (ap < MIN_AUCTION_START_PRICE_GBP) {
            return res.status(400).json({ ok: false, error: "auction_start_price_gbp must be >= 0.1 for auction" });
        }

        const endRaw = body.auction_end;
        if (typeof endRaw !== "string" || Number.isNaN(Date.parse(endRaw))) {
            return res.status(400).json({ ok: false, error: "auction_end must be a valid ISO datetime for auction" });
        }

        auction_start_price_gbp = ap;
        auction_end = new Date(endRaw).toISOString();
        priceNum = 0;
    }

    if (mode === "free") priceNum = 0;
    if (mode === "rent" && priceNum <= 0) {
        return res.status(400).json({ ok: false, error: "rent mode requires price_gbp > 0" });
    }

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
           auction_end=$13,
           auction_start_price_gbp=$14,
           parking_type=$15,
           capacity_total=$16,
           capacity_available=$17,
           updated_at=now()
       WHERE id=$18 AND owner_user_id=$19
       RETURNING *`,
                [
                    title.trim(),
                    description.trim(),
                    mode,
                    priceNum,
                    unit,
                    allow_points,
                    points_cost,
                    address_text.trim(),
                    lat,
                    lng,
                    image_url,
                    av.availability,
                    auction_end,
                    auction_start_price_gbp,
                    parking_type,
                    capacity_total,
                    capacity_available,
                    spotId,
                    req.userId,
                ]
            );
        } catch (e: any) {
            const msg = String(e?.message || e);
            if (
                msg.includes("parking_type") ||
                msg.includes("capacity_total") ||
                msg.includes("capacity_available") ||
                msg.includes("auction_end") ||
                msg.includes("auction_start_price_gbp")
            ) {
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
                    [
                        title.trim(),
                        description.trim(),
                        mode,
                        priceNum,
                        unit,
                        allow_points,
                        points_cost,
                        address_text.trim(),
                        lat,
                        lng,
                        image_url,
                        av.availability,
                        spotId,
                        req.userId,
                    ]
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

/**
 * DELETE /parking-spots/:id
 * Deletes a parking spot (owner only) and clears dependent data so the listing is removed app-wide.
 */
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

        // Keep reward history rows but detach them from the removed listing.
        await client.query(
            `UPDATE reward_transactions
             SET related_spot_id = NULL
             WHERE related_spot_id = $1`,
            [spotId]
        );

        // Backwards-compatible cleanup for environments that may not have full FK cascade coverage.
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

        // auction_bids table may not exist in older DB snapshots.
        try {
            await client.query(
                `DELETE FROM auction_bids
                 WHERE parking_spot_id = $1`,
                [spotId]
            );
        } catch {
            // ignore when auction_bids is unavailable
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

/**
 * GET /parking-spots
 */
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

        return res.json({ ok: true, parking_spots: spots });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

/**
 * GET /parking-spots/geocode/search?q=...
 * Proxies address search through the backend to avoid browser CORS issues.
 */
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

/**
 * GET /parking-spots/geocode/reverse?lat=...&lng=...
 * Proxies reverse geocoding through the backend to avoid browser CORS issues.
 */
router.get("/geocode/reverse", async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(typeof req.query.lng === "string" ? req.query.lng : req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return res.status(400).json({ ok: false, error: "lat/lng are invalid" });
    }

    try {
        const params = new URLSearchParams({
            format: "jsonv2",
            lat: String(lat),
            lon: String(lng),
            zoom: "18",
            addressdetails: "1",
        });

        const response = await fetch(`${NOMINATIM_BASE_URL}/reverse?${params.toString()}`, {
            headers: NOMINATIM_HEADERS,
        });
        if (!response.ok) {
            return res.status(502).json({ ok: false, error: `Reverse lookup provider error (${response.status})` });
        }

        const payload = (await response.json()) as { display_name?: string };
        const display_name = typeof payload.display_name === "string" ? payload.display_name : null;
        return res.json({ ok: true, display_name });
    } catch (e) {
        return res.status(503).json({ ok: false, error: "Reverse lookup is unavailable right now. Please try again." });
    }
});

/**
 * GET /parking-spots/:id
 */
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

        return res.json({ ok: true, parking_spot: r.rows[0] });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

export default router;
