exports.up = (pgm) => {
  pgm.createExtension("pgcrypto", {
    ifNotExists: true,
  });

  pgm.createTable("users", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },

    email: {
      type: "text",
      notNull: true,
    },

    display_name: {
      type: "text",
    },

    locale: {
      type: "varchar(20)",
      notNull: true,
      default: "en",
    },

    timezone: {
      type: "varchar(100)",
      notNull: true,
      default: "UTC",
    },

    email_verified_at: {
      type: "timestamptz",
    },

    last_login_at: {
      type: "timestamptz",
    },

    status: {
      type: "varchar(20)",
      notNull: true,
      default: "active",
    },

    onboarding_completed_at: {
      type: "timestamptz",
    },

    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },

    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },

    deleted_at: {
      type: "timestamptz",
    },
  });

  pgm.addConstraint("users", "users_status_check", {
    check: "status IN ('active', 'suspended')",
  });

  pgm.createIndex("users", "email", {
    name: "users_email_unique_active_idx",
    unique: true,
    where: "deleted_at IS NULL",
  });
};

exports.down = (pgm) => {
  pgm.dropTable("users");
};
