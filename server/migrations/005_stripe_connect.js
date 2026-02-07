/**
 * @type {import('node-pg-migrate').MigrationBuilder}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
    pgm.addColumns("users", {
        stripe_account_id: { type: "varchar(255)", notNull: false },
        stripe_charges_enabled: { type: "boolean", notNull: true, default: false },
        stripe_payouts_enabled: { type: "boolean", notNull: true, default: false },
        stripe_details_submitted: { type: "boolean", notNull: true, default: false },
    });

    pgm.createIndex("users", "stripe_account_id", {
        ifNotExists: true,
        where: "stripe_account_id IS NOT NULL",
    });
};

exports.down = (pgm) => {
    pgm.dropIndex("users", "stripe_account_id", {
        ifExists: true,
        where: "stripe_account_id IS NOT NULL",
    });

    pgm.dropColumns("users", [
        "stripe_account_id",
        "stripe_charges_enabled",
        "stripe_payouts_enabled",
        "stripe_details_submitted",
    ]);
};
