/**
 * @type {import('node-pg-migrate').MigrationBuilder}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
    // Home address was removed from the app before submission.
    // Keep this migration as a no-op so the history stays stable.
};

exports.down = (pgm) => {
    // No-op.
};
