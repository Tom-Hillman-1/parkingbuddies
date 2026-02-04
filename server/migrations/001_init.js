/**
 * @type {import('node-pg-migrate').MigrationBuilder}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
    // Needed for gen_random_uuid()
    pgm.createExtension("pgcrypto", { ifNotExists: true });

    // USERS
    pgm.createTable("users", {
        id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
        email: { type: "varchar(255)", notNull: true, unique: true },
        name: { type: "varchar(120)", notNull: true },
        password_hash: { type: "text", notNull: true },

        // reward system
        points_balance: { type: "integer", notNull: true, default: 0 },

        created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
        updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    });

    // PARKING SPOTS (LISTINGS)
    pgm.createTable("parking_spots", {
        id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },

        owner_user_id: {
            type: "uuid",
            notNull: true,
            references: "users",
            onDelete: "cascade",
        },

        title: { type: "varchar(120)", notNull: true },
        description: { type: "text", notNull: true },

        // mode required by PDD: free/rent/auction
        mode: { type: "varchar(10)", notNull: true },

        // pricing (0 for free)
        price_gbp: { type: "numeric(10,2)", notNull: true, default: 0 },

        // points booking support
        allow_points: { type: "boolean", notNull: true, default: false },
        points_cost: { type: "integer", notNull: true, default: 0 },

        // location
        address_text: { type: "text", notNull: true },
        lat: { type: "double precision", notNull: true },
        lng: { type: "double precision", notNull: true },

        // image (mock URL ok)
        image_url: { type: "text", notNull: false },

        // availability window (optional)
        availability_start: { type: "timestamptz", notNull: false },
        availability_end: { type: "timestamptz", notNull: false },

        is_active: { type: "boolean", notNull: true, default: true },

        created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
        updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    });

    pgm.addConstraint("parking_spots", "parking_spots_mode_check", {
        check: "mode IN ('free', 'rent', 'auction')",
    });

    // BOOKINGS
    pgm.createTable("bookings", {
        id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },

        parking_spot_id: {
            type: "uuid",
            notNull: true,
            references: "parking_spots",
            onDelete: "cascade",
        },

        driver_user_id: {
            type: "uuid",
            notNull: true,
            references: "users",
            onDelete: "cascade",
        },

        start_time: { type: "timestamptz", notNull: true },
        end_time: { type: "timestamptz", notNull: true },

        status: { type: "varchar(15)", notNull: true, default: "pending" },

        // payment method: money or points
        pay_method: { type: "varchar(10)", notNull: true, default: "money" },

        // snapshot totals
        total_price_gbp: { type: "numeric(10,2)", notNull: true, default: 0 },
        total_points: { type: "integer", notNull: true, default: 0 },

        created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
        updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    });

    pgm.addConstraint("bookings", "bookings_status_check", {
        check: "status IN ('pending', 'confirmed', 'cancelled', 'completed')",
    });

    pgm.addConstraint("bookings", "bookings_pay_method_check", {
        check: "pay_method IN ('money', 'points')",
    });

    // REWARD TRANSACTIONS (for dashboard history)
    pgm.createTable("reward_transactions", {
        id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },

        user_id: {
            type: "uuid",
            notNull: true,
            references: "users",
            onDelete: "cascade",
        },

        type: { type: "varchar(12)", notNull: true }, // earn/spend
        amount: { type: "integer", notNull: true },
        reason: { type: "varchar(50)", notNull: true },

        related_booking_id: { type: "uuid", notNull: false, references: "bookings", onDelete: "set null" },
        related_spot_id: { type: "uuid", notNull: false, references: "parking_spots", onDelete: "set null" },

        created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    });

    pgm.addConstraint("reward_transactions", "reward_transactions_type_check", {
        check: "type IN ('earn', 'spend')",
    });

    // PAYMENTS (store test payments later)
    pgm.createTable("payments", {
        id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },

        booking_id: {
            type: "uuid",
            notNull: true,
            references: "bookings",
            onDelete: "cascade",
        },

        provider: { type: "varchar(10)", notNull: true, default: "stripe" },
        status: { type: "varchar(15)", notNull: true, default: "created" },

        amount_gbp: { type: "numeric(10,2)", notNull: true, default: 0 },

        provider_ref: { type: "text", notNull: false },

        created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
        updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    });

    pgm.addConstraint("payments", "payments_provider_check", {
        check: "provider IN ('stripe', 'paypal', 'gpay')",
    });

    pgm.addConstraint("payments", "payments_status_check", {
        check: "status IN ('created', 'pending', 'succeeded', 'failed', 'refunded')",
    });

    // Minimal helpful indexes
    pgm.createIndex("parking_spots", "owner_user_id");
    pgm.createIndex("bookings", "parking_spot_id");
    pgm.createIndex("bookings", "driver_user_id");
    pgm.createIndex("reward_transactions", "user_id");
    pgm.createIndex("payments", "booking_id");
};

exports.down = (pgm) => {
    pgm.dropTable("payments");
    pgm.dropTable("reward_transactions");
    pgm.dropTable("bookings");
    pgm.dropTable("parking_spots");
    pgm.dropTable("users");
};