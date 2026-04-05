/**
 * @type {import('node-pg-migrate').MigrationBuilder}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
    // Keep one forward-safe place that guarantees expected columns/constraints
    // when older duplicated migrations have run in different orders.
    pgm.sql(`
        ALTER TABLE parking_spots
            ADD COLUMN IF NOT EXISTS auction_end timestamptz,
            ADD COLUMN IF NOT EXISTS auction_start_price_gbp numeric(10,2),
            ADD COLUMN IF NOT EXISTS parking_type varchar(12) NOT NULL DEFAULT 'private',
            ADD COLUMN IF NOT EXISTS capacity_total integer NOT NULL DEFAULT 1;
    `);

    pgm.sql(`
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'parking_spots_parking_type_check'
            ) THEN
                ALTER TABLE parking_spots
                    ADD CONSTRAINT parking_spots_parking_type_check
                    CHECK (parking_type IN ('private','public'));
            END IF;
        END$$;
    `);
};

exports.down = (_pgm) => {};
