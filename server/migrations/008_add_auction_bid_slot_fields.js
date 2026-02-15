/**
 * @type {import('node-pg-migrate').MigrationBuilder}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE auction_bids
            ADD COLUMN IF NOT EXISTS start_time timestamptz,
            ADD COLUMN IF NOT EXISTS end_time timestamptz,
            ADD COLUMN IF NOT EXISTS pay_method varchar(10) NOT NULL DEFAULT 'money',
            ADD COLUMN IF NOT EXISTS amount_points integer NOT NULL DEFAULT 0;
    `);

    pgm.sql(`
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'auction_bids_pay_method_check'
            ) THEN
                ALTER TABLE auction_bids
                    ADD CONSTRAINT auction_bids_pay_method_check
                    CHECK (pay_method IN ('money', 'points'));
            END IF;
        END$$;
    `);

    pgm.sql(`
        UPDATE auction_bids
        SET pay_method = COALESCE(pay_method, 'money'),
            amount_points = COALESCE(amount_points, 0)
        WHERE pay_method IS NULL OR amount_points IS NULL;
    `);
};

exports.down = (pgm) => {
    pgm.sql(`
        ALTER TABLE auction_bids
            DROP CONSTRAINT IF EXISTS auction_bids_pay_method_check,
            DROP COLUMN IF EXISTS start_time,
            DROP COLUMN IF EXISTS end_time,
            DROP COLUMN IF EXISTS pay_method,
            DROP COLUMN IF EXISTS amount_points;
    `);
};
