/**
 * @type {import('node-pg-migrate').MigrationBuilder}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
    // Make migration idempotent so it can be rerun safely.
    pgm.sql(`
        ALTER TABLE parking_spots
            ADD COLUMN IF NOT EXISTS auction_end timestamptz,
            ADD COLUMN IF NOT EXISTS auction_start_price_gbp numeric(10,2),
            ADD COLUMN IF NOT EXISTS parking_type varchar(12) NOT NULL DEFAULT 'private',
            ADD COLUMN IF NOT EXISTS capacity_total integer NOT NULL DEFAULT 1,
            ADD COLUMN IF NOT EXISTS capacity_available integer NOT NULL DEFAULT 1;
    `);

    pgm.sql(`
        CREATE TABLE IF NOT EXISTS auction_bids (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            parking_spot_id uuid NOT NULL REFERENCES parking_spots ON DELETE cascade,
            bidder_user_id uuid NOT NULL REFERENCES users ON DELETE cascade,
            amount_gbp numeric(10,2) NOT NULL,
            status varchar(12) NOT NULL DEFAULT 'pending',
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        );
    `);

    pgm.sql(`
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'auction_bids_status_check'
            ) THEN
                ALTER TABLE auction_bids
                    ADD CONSTRAINT auction_bids_status_check
                    CHECK (status IN ('pending', 'accepted', 'rejected', 'outbid', 'won', 'lost'));
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'parking_spots_parking_type_check'
            ) THEN
                ALTER TABLE parking_spots
                    ADD CONSTRAINT parking_spots_parking_type_check
                    CHECK (parking_type IN ('private','public'));
            END IF;
        END$$;
    `);

    pgm.sql(`CREATE INDEX IF NOT EXISTS auction_bids_parking_spot_id_index ON auction_bids (parking_spot_id);`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS auction_bids_bidder_user_id_index ON auction_bids (bidder_user_id);`);
};

exports.down = (pgm) => {
    pgm.sql(`DROP TABLE IF EXISTS auction_bids;`);
    pgm.sql(`
        ALTER TABLE parking_spots
            DROP CONSTRAINT IF EXISTS parking_spots_parking_type_check,
            DROP COLUMN IF EXISTS parking_type,
            DROP COLUMN IF EXISTS capacity_total,
            DROP COLUMN IF EXISTS capacity_available,
            DROP COLUMN IF EXISTS auction_end,
            DROP COLUMN IF EXISTS auction_start_price_gbp;
    `);
};
