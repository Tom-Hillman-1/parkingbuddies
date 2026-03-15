/**
 * @type {import('node-pg-migrate').MigrationBuilder}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
    pgm.addColumns("users", {
        token_version: { type: "integer", notNull: true, default: 0 },
    });
};

exports.down = (pgm) => {
    pgm.dropColumns("users", ["token_version"]);
};
