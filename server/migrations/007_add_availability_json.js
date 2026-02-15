/**
 * @type {import('node-pg-migrate').MigrationBuilder}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE parking_spots
            ADD COLUMN IF NOT EXISTS price_unit varchar(10) NOT NULL DEFAULT 'hour',
            ADD COLUMN IF NOT EXISTS availability_json jsonb,
            ADD COLUMN IF NOT EXISTS availability_type varchar(20) NOT NULL DEFAULT '24_7',
            ADD COLUMN IF NOT EXISTS available_days integer[],
            ADD COLUMN IF NOT EXISTS daily_start time,
            ADD COLUMN IF NOT EXISTS daily_end time;
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

            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'parking_spots_availability_type_check'
            ) THEN
                ALTER TABLE parking_spots
                    ADD CONSTRAINT parking_spots_availability_type_check
                    CHECK (availability_type IN ('24_7', 'weekly'));
            END IF;
        END$$;
    `);
};

exports.down = (pgm) => {
    pgm.sql(`
        ALTER TABLE parking_spots
            DROP CONSTRAINT IF EXISTS parking_spots_price_unit_check,
            DROP CONSTRAINT IF EXISTS parking_spots_availability_type_check,
            DROP COLUMN IF EXISTS price_unit,
            DROP COLUMN IF EXISTS availability_json,
            DROP COLUMN IF EXISTS availability_type,
            DROP COLUMN IF EXISTS available_days,
            DROP COLUMN IF EXISTS daily_start,
            DROP COLUMN IF EXISTS daily_end;
    `);
};
