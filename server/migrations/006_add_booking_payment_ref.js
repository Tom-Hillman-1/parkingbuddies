/****** @type {import('node-pg-migrate').MigrationBuilder} ******/
exports.shorthands = undefined;

exports.up = (pgm) => {
    pgm.addColumns("bookings", {
        payment_provider_ref: { type: "varchar(255)", notNull: false },
    });
};

exports.down = (pgm) => {
    pgm.dropColumns("bookings", ["payment_provider_ref"]);
};
