/**
 * @type {import('node-pg-migrate').MigrationBuilder}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
    pgm.addColumns("parking_spots", {
        owner_contact_email: { type: "text", notNull: false },
        owner_contact_phone: { type: "text", notNull: false },
        owner_contact_info: { type: "text", notNull: false },
    });
};

exports.down = (pgm) => {
    pgm.dropColumns("parking_spots", [
        "owner_contact_email",
        "owner_contact_phone",
        "owner_contact_info",
    ]);
};

