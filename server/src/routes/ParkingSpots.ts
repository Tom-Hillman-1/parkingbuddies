import { Router } from "express";
import { pool } from "../db";
import { requireAuth, AuthRequest } from "../middleware/auth";

const router = Router();

// reward amount for uploading a listing (PDD #8)
const LISTING_REWARD_POINTS = 5;
const IMAGE_REWARD_POINTS = 2;

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
    if (mode === "free" && allow_points) {
        return res.status(400).json({ ok: false, error: "Points cannot be enabled for free listings" });
    }
    if (allow_points && points_cost <= 0) {
        return res.status(400).json({ ok: false, error: "points_cost must be > 0 when allow_points is true" });
    }

    // availability (new or old)
    const av = buildAvailabilityJson(body);
    if (!av.ok) return res.status(400).json({ ok: false, error: av.error });

    // Auction validation (store fields; booking is blocked in bookings.ts)
    let auction_end: string | null = null;
    let auction_start_price_gbp: number | null = null;

    if (mode === "auction") {
        const ap = safeMoney(body.auction_start_price_gbp);
        if (ap <= 0) return res.status(400).json({ ok: false, error: "auction_start_price_gbp must be > 0 for auction" });

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
    if (mode === "free" && allow_points) {
        return res.status(400).json({ ok: false, error: "Points cannot be enabled for free listings" });
    }
    if (allow_points && points_cost <= 0) {
        return res.status(400).json({ ok: false, error: "points_cost must be > 0 when allow_points is true" });
    }

    const av = buildAvailabilityJson(body);
    if (!av.ok) return res.status(400).json({ ok: false, error: av.error });

    let auction_end: string | null = null;
    let auction_start_price_gbp: number | null = null;

    if (mode === "auction") {
        const ap = safeMoney(body.auction_start_price_gbp);
        if (ap <= 0) return res.status(400).json({ ok: false, error: "auction_start_price_gbp must be > 0 for auction" });

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
 * GET /parking-spots
 */
router.get("/", async (_req, res) => {
    try {
        const r = await pool.query(
            `SELECT *
       FROM parking_spots
       WHERE is_active = true
       ORDER BY created_at DESC`
        );
        return res.json({ ok: true, parking_spots: r.rows });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
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
