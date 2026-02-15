const dotenv = require("dotenv");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    console.error("DATABASE_URL is missing. Add it to server/.env");
    process.exit(1);
}

const pool = new Pool({ connectionString });

function addDays(d, days) {
    const out = new Date(d);
    out.setDate(out.getDate() + days);
    return out;
}

async function seed() {
    const client = await pool.connect();
    try {
        const existing = await client.query("SELECT COUNT(*)::int AS count FROM users");
        if ((existing.rows[0]?.count ?? 0) > 0) {
            console.log("Seed skipped: users already exist.");
            return;
        }

        await client.query("BEGIN");

        const passwordHash = await bcrypt.hash("demo1234", 10);

        const ownerR = await client.query(
            `INSERT INTO users (email, name, password_hash, points_balance)
             VALUES ($1, $2, $3, $4)
             RETURNING id`,
            ["owner@demo.com", "Demo Owner", passwordHash, 250]
        );
        const driverR = await client.query(
            `INSERT INTO users (email, name, password_hash, points_balance)
             VALUES ($1, $2, $3, $4)
             RETURNING id`,
            ["driver@demo.com", "Demo Driver", passwordHash, 120]
        );

        const ownerId = ownerR.rows[0].id;
        const driverId = driverR.rows[0].id;

        const auctionEnd = addDays(new Date(), 7).toISOString();

        const rentSpotR = await client.query(
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
                auction_end,
                auction_start_price_gbp,
                parking_type,
                capacity_total,
                capacity_available
            )
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
             RETURNING id`,
            [
                ownerId,
                "City Center Garage",
                "Covered garage space close to the main station.",
                "rent",
                4.5,
                true,
                8,
                "12 Market St, London",
                51.5074,
                -0.1278,
                null,
                null,
                null,
                "private",
                1,
                1,
            ]
        );

        const freeSpotR = await client.query(
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
                auction_end,
                auction_start_price_gbp,
                parking_type,
                capacity_total,
                capacity_available
            )
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
             RETURNING id`,
            [
                ownerId,
                "Riverside Free Spot",
                "Uncovered spot with quick access to the riverside path.",
                "free",
                0,
                false,
                0,
                "8 Riverside Walk, London",
                51.505,
                -0.11,
                null,
                null,
                null,
                "public",
                2,
                2,
            ]
        );

        const auctionSpotR = await client.query(
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
                auction_end,
                auction_start_price_gbp,
                parking_type,
                capacity_total,
                capacity_available
            )
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
             RETURNING id`,
            [
                ownerId,
                "Market Street Auction",
                "Auction-only listing with flexible evening hours.",
                "auction",
                0,
                true,
                10,
                "22 Market St, London",
                51.509,
                -0.09,
                null,
                auctionEnd,
                2.0,
                "private",
                1,
                1,
            ]
        );

        const rentSpotId = rentSpotR.rows[0].id;
        const auctionSpotId = auctionSpotR.rows[0].id;

        const bookingStart = addDays(new Date(), 1);
        bookingStart.setHours(9, 0, 0, 0);
        const bookingEnd = new Date(bookingStart.getTime() + 2 * 60 * 60 * 1000);

        await client.query(
            `INSERT INTO bookings (
                parking_spot_id,
                driver_user_id,
                start_time,
                end_time,
                status,
                pay_method,
                total_price_gbp,
                total_points
            )
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [rentSpotId, driverId, bookingStart.toISOString(), bookingEnd.toISOString(), "confirmed", "money", 9.0, 0]
        );

        await client.query(
            `INSERT INTO auction_bids (
                parking_spot_id,
                bidder_user_id,
                amount_gbp,
                status
            )
             VALUES ($1,$2,$3,$4)`,
            [auctionSpotId, driverId, 5.5, "pending"]
        );

        await client.query("COMMIT");
        console.log("Seed complete.");
    } catch (e) {
        await client.query("ROLLBACK");
        throw e;
    } finally {
        client.release();
        await pool.end();
    }
}

seed().catch((err) => {
    console.error(err);
    process.exit(1);
});
