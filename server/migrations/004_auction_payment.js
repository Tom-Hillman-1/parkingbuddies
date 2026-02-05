/**
 * @type {import('node-pg-migrate').MigrationBuilder}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE auction_bids
            ADD COLUMN IF NOT EXISTS payment_intent_id varchar(80);
    `);
};

exports.down = (pgm) => {
    pgm.sql(`
        ALTER TABLE auction_bids
            DROP COLUMN IF EXISTS payment_intent_id;
    `);
};
