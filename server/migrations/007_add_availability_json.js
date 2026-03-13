/**
 * @type {import('node-pg-migrate').MigrationBuilder}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE parking_spots
            ADD COLUMN IF NOT EXISTS price_unit varchar(10) NOT NULL DEFAULT 'hour',
            ADD COLUMN IF NOT EXISTS availability_json jsonb;
    `);

    pgm.sql(`
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'parking_spots_price_unit_check'
            ) THEN
                ALTER TABLE parking_spots
                    ADD CONSTRAINT parking_spots_price_unit_check
                    CHECK (price_unit IN ('hour', 'day', 'week'));
            END IF;

        END$$;
    `);
};

exports.down = (pgm) => {
    pgm.sql(`
        ALTER TABLE parking_spots
            DROP CONSTRAINT IF EXISTS parking_spots_price_unit_check,
            DROP COLUMN IF EXISTS price_unit,
            DROP COLUMN IF EXISTS availability_json;
    `);
};
