/**
 * @type {import('node-pg-migrate').MigrationBuilder}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE users
            ADD COLUMN IF NOT EXISTS home_address text;
    `);
};

exports.down = (pgm) => {
    pgm.sql(`
        ALTER TABLE users
            DROP COLUMN IF EXISTS home_address;
    `);
};

