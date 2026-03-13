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

function addDays(base, days) {
    const out = new Date(base);
    out.setDate(out.getDate() + days);
    return out;
}

function at(daysAhead, hours, minutes) {
    const d = addDays(new Date(), daysAhead);
    d.setHours(hours, minutes, 0, 0);
    return d;
}

function ymd(daysAhead) {
    return addDays(new Date(), daysAhead).toISOString().slice(0, 10);
}

function continuousWindow(dateFrom, dateTo, start, end) {
    return {
        type: "window_slots",
        windows: [
            {
                mode: "continuous",
                date_from: dateFrom,
                date_to: dateTo,
                start,
                end,
            },
        ],
    };
}

async function insertSpot(client, ownerId, data) {
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
            is_active
        )
         VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
        )
         RETURNING id, title`,
        [
            ownerId,
            data.title,
            data.description,
            data.mode,
            data.price_gbp,
            data.price_unit,
            data.allow_points,
            data.points_cost,
            data.address_text,
            data.lat,
            data.lng,
            data.image_url,
            data.availability_json,
            data.auction_end,
            data.auction_start_price_gbp,
            data.parking_type,
            data.capacity_total,
            true,
        ]
    );
    return r.rows[0];
}

async function seed() {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        await client.query(`
            TRUNCATE TABLE
                payments,
                reward_transactions,
                bookings,
                auction_bids,
                parking_spots,
                users
            RESTART IDENTITY CASCADE
        `);

        const passwordHash = await bcrypt.hash("demo1234", 10);

        const ownerR = await client.query(
            `INSERT INTO users (
                email,
                name,
                password_hash,
                points_balance,
                stripe_account_id,
                stripe_charges_enabled,
                stripe_payouts_enabled,
                stripe_details_submitted
            )
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             RETURNING id`,
            [
                "owner@demo.com",
                "Demo Owner",
                passwordHash,
                1474,
                "acct_demo_owner_connected",
                true,
                true,
                true,
            ]
        );

        const driverR = await client.query(
            `INSERT INTO users (
                email,
                name,
                password_hash,
                points_balance,
                stripe_account_id,
                stripe_charges_enabled,
                stripe_payouts_enabled,
                stripe_details_submitted
            )
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             RETURNING id`,
            [
                "driver@demo.com",
                "Demo Driver",
                passwordHash,
                632,
                null,
                false,
                false,
                false,
            ]
        );

        const ownerId = ownerR.rows[0].id;
        const driverId = driverR.rows[0].id;

        await client.query(
            `INSERT INTO reward_transactions (user_id, type, amount, reason)
             VALUES
                 ($1, 'earn', 1400, 'seed_opening_balance'),
                 ($2, 'earn', 650, 'seed_opening_balance')`,
            [ownerId, driverId]
        );

        const listingRows = [];
        listingRows.push(
            await insertSpot(client, ownerId, {
                title: "Canary Wharf Secure Garage",
                description: "Covered bay with CCTV and direct access to the station.",
                mode: "rent",
                price_gbp: 5.5,
                price_unit: "hour",
                allow_points: true,
                points_cost: 12,
                address_text: "14 Bank St, Canary Wharf, London",
                lat: 51.5047,
                lng: -0.0189,
                image_url: "/seed/pexels-bylukemiller-28986817.jpg",
                availability_json: continuousWindow(ymd(0), ymd(120), "06:00", "23:00"),
                auction_end: null,
                auction_start_price_gbp: null,
                parking_type: "private",
                capacity_total: 1,
            })
        );

        listingRows.push(
            await insertSpot(client, ownerId, {
                title: "Heathrow Private Hangar Bay",
                description: "Large secure hangar-side bay near Heathrow, suited to longer stays and airport access.",
                mode: "rent",
                price_gbp: 22,
                price_unit: "day",
                allow_points: false,
                points_cost: 0,
                address_text: "Heathrow Airport, Hangar Rd, Hounslow, London",
                lat: 51.4700,
                lng: -0.4543,
                image_url: "/seed/pexels-cesar-mirna-choto-3196372-6016513.jpg",
                availability_json: continuousWindow(ymd(0), ymd(180), "00:00", "23:59"),
                auction_end: null,
                auction_start_price_gbp: null,
                parking_type: "private",
                capacity_total: 1,
            })
        );

        listingRows.push(
            await insertSpot(client, ownerId, {
                title: "Shoreditch Free Curbside Spot",
                description: "Free community slot near local shops, weekdays only.",
                mode: "free",
                price_gbp: 0,
                price_unit: "hour",
                allow_points: false,
                points_cost: 0,
                address_text: "88 Curtain Rd, Shoreditch, London",
                lat: 51.5242,
                lng: -0.0786,
                image_url: "/seed/pexels-davegarcia-36259602.jpg",
                availability_json: continuousWindow(ymd(0), ymd(90), "08:00", "19:00"),
                auction_end: null,
                auction_start_price_gbp: null,
                parking_type: "public",
                capacity_total: 2,
            })
        );

        listingRows.push(
            await insertSpot(client, ownerId, {
                title: "Soho Evening Auction Spot",
                description: "Prime evening slot for West End visits and theatre nights.",
                mode: "auction",
                price_gbp: 0,
                price_unit: "hour",
                allow_points: true,
                points_cost: 16,
                address_text: "20 Wardour St, Soho, London",
                lat: 51.5137,
                lng: -0.1313,
                image_url: "/seed/pexels-garvin-st-villier-719266-4037254.jpg",
                availability_json: continuousWindow(ymd(0), ymd(45), "00:00", "23:59"),
                auction_end: addDays(new Date(), 12).toISOString(),
                auction_start_price_gbp: 2.5,
                parking_type: "private",
                capacity_total: 1,
            })
        );

        listingRows.push(
            await insertSpot(client, ownerId, {
                title: "Kings Cross Weekly Garage",
                description: "Best for commuters and week-long stays near the rail hub.",
                mode: "rent",
                price_gbp: 84,
                price_unit: "week",
                allow_points: true,
                points_cost: 75,
                address_text: "3 Pancras Sq, Kings Cross, London",
                lat: 51.5342,
                lng: -0.1257,
                image_url: "/seed/pexels-nessip-5359816.jpg",
                availability_json: continuousWindow(ymd(0), ymd(180), "00:00", "23:59"),
                auction_end: null,
                auction_start_price_gbp: null,
                parking_type: "private",
                capacity_total: 1,
            })
        );

        listingRows.push(
            await insertSpot(client, ownerId, {
                title: "Brixton Market Auction Bay",
                description: "Busy-zone listing with high demand during market hours.",
                mode: "auction",
                price_gbp: 0,
                price_unit: "hour",
                allow_points: false,
                points_cost: 0,
                address_text: "45 Atlantic Rd, Brixton, London",
                lat: 51.4626,
                lng: -0.1144,
                image_url: "/seed/pexels-olgalioncat-7247536.jpg",
                availability_json: continuousWindow(ymd(0), ymd(60), "07:00", "22:00"),
                auction_end: addDays(new Date(), 8).toISOString(),
                auction_start_price_gbp: 1.8,
                parking_type: "private",
                capacity_total: 1,
            })
        );

        listingRows.push(
            await insertSpot(client, ownerId, {
                title: "Camden Multi-Space Lot",
                description: "Public lot with several spaces and good daytime flow.",
                mode: "rent",
                price_gbp: 3.25,
                price_unit: "hour",
                allow_points: true,
                points_cost: 9,
                address_text: "9 Camden High St, Camden, London",
                lat: 51.5392,
                lng: -0.1426,
                image_url: "/seed/pexels-pixabay-63294.jpg",
                availability_json: continuousWindow(ymd(0), ymd(365), "00:00", "23:59"),
                auction_end: null,
                auction_start_price_gbp: null,
                parking_type: "public",
                capacity_total: 4,
            })
        );

        listingRows.push(
            await insertSpot(client, ownerId, {
                title: "Greenwich Free Driveway",
                description: "Quiet free driveway near parks and riverside paths.",
                mode: "free",
                price_gbp: 0,
                price_unit: "hour",
                allow_points: false,
                points_cost: 0,
                address_text: "11 Park Vista, Greenwich, London",
                lat: 51.4769,
                lng: -0.0005,
                image_url: "/seed/pexels-ryan-morris-266262543-15460734.jpg",
                availability_json: continuousWindow(ymd(0), ymd(180), "00:00", "23:59"),
                auction_end: null,
                auction_start_price_gbp: null,
                parking_type: "private",
                capacity_total: 1,
            })
        );

        const spotIds = Object.fromEntries(listingRows.map((row) => [row.title, row.id]));

        const rentBookingStart = at(1, 9, 0);
        const rentBookingEnd = at(1, 11, 0);
        const pendingBookingStart = at(3, 8, 0);
        const pendingBookingEnd = at(4, 8, 0);
        const pointsBookingStart = at(2, 14, 0);
        const pointsBookingEnd = at(2, 16, 0);
        const weeklyBookingStart = at(5, 10, 0);
        const weeklyBookingEnd = at(12, 10, 0);

        const bookingMoneyConfirmedR = await client.query(
            `INSERT INTO bookings (
                parking_spot_id,
                driver_user_id,
                start_time,
                end_time,
                status,
                pay_method,
                total_price_gbp,
                total_points,
                payment_provider_ref
            )
             VALUES ($1,$2,$3,$4,'confirmed','money',$5,0,$6)
             RETURNING id`,
            [
                spotIds["Canary Wharf Secure Garage"],
                driverId,
                rentBookingStart.toISOString(),
                rentBookingEnd.toISOString(),
                "11.00",
                "pi_demo_paid_001",
            ]
        );

        const bookingMoneyPendingR = await client.query(
            `INSERT INTO bookings (
                parking_spot_id,
                driver_user_id,
                start_time,
                end_time,
                status,
                pay_method,
                total_price_gbp,
                total_points,
                payment_provider_ref
            )
             VALUES ($1,$2,$3,$4,'pending','money',$5,0,$6)
             RETURNING id`,
            [
                spotIds["Heathrow Private Hangar Bay"],
                driverId,
                pendingBookingStart.toISOString(),
                pendingBookingEnd.toISOString(),
                "22.00",
                "pi_demo_pending_001",
            ]
        );

        const bookingPointsConfirmedR = await client.query(
            `INSERT INTO bookings (
                parking_spot_id,
                driver_user_id,
                start_time,
                end_time,
                status,
                pay_method,
                total_price_gbp,
                total_points,
                payment_provider_ref
            )
             VALUES ($1,$2,$3,$4,'confirmed','points','0.00',$5,$6)
             RETURNING id`,
            [
                spotIds["Camden Multi-Space Lot"],
                driverId,
                pointsBookingStart.toISOString(),
                pointsBookingEnd.toISOString(),
                18,
                "points_demo_001",
            ]
        );

        const bookingWeeklyConfirmedR = await client.query(
            `INSERT INTO bookings (
                parking_spot_id,
                driver_user_id,
                start_time,
                end_time,
                status,
                pay_method,
                total_price_gbp,
                total_points,
                payment_provider_ref
            )
             VALUES ($1,$2,$3,$4,'confirmed','money',$5,0,$6)
             RETURNING id`,
            [
                spotIds["Kings Cross Weekly Garage"],
                driverId,
                weeklyBookingStart.toISOString(),
                weeklyBookingEnd.toISOString(),
                "84.00",
                "pi_demo_paid_002",
            ]
        );

        await client.query(
            `INSERT INTO payments (booking_id, provider, provider_ref, status, amount_gbp)
             VALUES
                 ($1, 'stripe', 'ch_demo_paid_001', 'succeeded', 11.00),
                 ($2, 'stripe', 'pi_demo_pending_001', 'created', 22.00),
                 ($3, 'stripe', 'ch_demo_paid_002', 'succeeded', 84.00)`,
            [
                bookingMoneyConfirmedR.rows[0].id,
                bookingMoneyPendingR.rows[0].id,
                bookingWeeklyConfirmedR.rows[0].id,
            ]
        );

        const acceptedAuctionStart = at(2, 18, 0);
        const acceptedAuctionEnd = at(2, 22, 0);
        const pendingAuctionMultiStart = at(4, 10, 0);
        const pendingAuctionMultiEnd = at(6, 10, 0);
        const pendingAuctionPointsStart = at(7, 9, 0);
        const pendingAuctionPointsEnd = at(7, 17, 0);
        const pendingBrixtonStart = at(5, 18, 0);
        const pendingBrixtonEnd = at(5, 22, 0);

        await client.query(
            `INSERT INTO auction_bids (
                parking_spot_id,
                bidder_user_id,
                amount_gbp,
                amount_points,
                pay_method,
                status,
                payment_intent_id,
                start_time,
                end_time
            )
             VALUES
                ($1,$2,18.00,0,'money','accepted','pi_demo_auction_accepted',$3,$4),
                ($1,$2,48.00,0,'money','pending','pi_demo_auction_pending_multi',$5,$6),
                ($1,$2,0.00,24,'points','pending',NULL,$7,$8),
                ($9,$2,25.00,0,'money','pending','pi_demo_brixton_pending',$10,$11),
                ($9,$2,19.50,0,'money','rejected','pi_demo_brixton_rejected',$12,$13)`,
            [
                spotIds["Soho Evening Auction Spot"],
                driverId,
                acceptedAuctionStart.toISOString(),
                acceptedAuctionEnd.toISOString(),
                pendingAuctionMultiStart.toISOString(),
                pendingAuctionMultiEnd.toISOString(),
                pendingAuctionPointsStart.toISOString(),
                pendingAuctionPointsEnd.toISOString(),
                spotIds["Brixton Market Auction Bay"],
                pendingBrixtonStart.toISOString(),
                pendingBrixtonEnd.toISOString(),
                at(1, 12, 0).toISOString(),
                at(1, 16, 0).toISOString(),
            ]
        );

        await client.query(
            `INSERT INTO reward_transactions (user_id, type, amount, reason, related_spot_id)
             SELECT $1, 'earn', 5, 'listing_upload', id
             FROM parking_spots
             WHERE owner_user_id = $1`,
            [ownerId]
        );

        await client.query(
            `INSERT INTO reward_transactions (user_id, type, amount, reason, related_spot_id)
             SELECT $1, 'earn', 2, 'listing_photo', id
             FROM parking_spots
             WHERE owner_user_id = $1`,
            [ownerId]
        );

        await client.query(
            `INSERT INTO reward_transactions (user_id, type, amount, reason, related_booking_id, related_spot_id)
             VALUES
                ($1, 'spend', 18, 'booking_with_points', $2, $3),
                ($4, 'earn', 18, 'booking_points_received', $2, $3)`,
            [
                driverId,
                bookingPointsConfirmedR.rows[0].id,
                spotIds["Camden Multi-Space Lot"],
                ownerId,
            ]
        );

        await client.query("COMMIT");

        console.log("Seed complete.");
        console.log("Demo owner: owner@demo.com / demo1234");
        console.log("Demo driver: driver@demo.com / demo1234");
        console.log(`Listings created: ${listingRows.length}`);
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
