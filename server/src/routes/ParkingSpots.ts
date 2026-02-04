import { Router } from "express";
import { pool } from "../db";
import { requireAuth, AuthRequest } from "../middleware/auth";

const router = Router();

/**
 * POST /parking-spots
 * Create a parking spot listing
 */
router.post("/", requireAuth, async (req: AuthRequest, res) => {
    const {
        title,
        description,
        mode,
        price_gbp,
        allow_points,
        points_cost,
        address_text,
        lat,
        lng,
        image_url,
        availability_start,
        availability_end,
    } = req.body ?? {};

    // Basic validation (simple + enough for PDD)
    if (
        typeof title !== "string" ||
        typeof description !== "string" ||
        typeof mode !== "string" ||
        typeof address_text !== "string" ||
        typeof lat !== "number" ||
        typeof lng !== "number"
    ) {
        return res.status(400).json({ ok: false, error: "Missing or invalid fields" });
    }

    if (!["free", "rent", "auction"].includes(mode)) {
        return res.status(400).json({ ok: false, error: "Invalid parking mode" });
    }

    try {
        const r = await pool.query(
            `INSERT INTO parking_spots (
        owner_user_id,
        title,
        description,
        mode,
        price_gbp,
        allow_points,
        points_cost,
        address_text,
        lat,
        lng,
        image_url,
        availability_start,
        availability_end
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
      )
      RETURNING *`,
            [
                req.userId,
                title,
                description,
                mode,
                price_gbp ?? 0,
                allow_points ?? false,
                points_cost ?? 0,
                address_text,
                lat,
                lng,
                image_url ?? null,
                availability_start ?? null,
                availability_end ?? null,
            ]
        );

        return res.status(201).json({ ok: true, parking_spot: r.rows[0] });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

/**
 * GET /parking-spots
 * List all active parking spots
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
 * Get single parking spot
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