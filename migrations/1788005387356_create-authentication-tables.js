exports.up = (pgm) => {
  pgm.createTable("login_codes", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },

    email: {
      type: "text",
      notNull: true,
    },

    code_hash: {
      type: "text",
      notNull: true,
    },

    purpose: {
      type: "varchar(30)",
      notNull: true,
      default: "login",
    },

    attempts_count: {
      type: "smallint",
      notNull: true,
      default: 0,
    },

    expires_at: {
      type: "timestamptz",
      notNull: true,
    },

    consumed_at: {
      type: "timestamptz",
    },

    requested_ip: {
      type: "inet",
    },

    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.addConstraint("login_codes", "login_codes_purpose_check", {
    check: "purpose IN ('login', 'email_change')",
  });

  pgm.addConstraint("login_codes", "login_codes_attempts_count_check", {
    check: "attempts_count >= 0",
  });

  pgm.createIndex("login_codes", ["email", "purpose", "created_at"], {
    name: "login_codes_email_purpose_created_at_idx",
  });

  pgm.createIndex("login_codes", "expires_at", {
    name: "login_codes_expires_at_idx",
  });

  pgm.createTable("user_sessions", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },

    user_id: {
      type: "uuid",
      notNull: true,
      references: "users",
      onDelete: "CASCADE",
    },

    refresh_token_hash: {
      type: "text",
      notNull: true,
      unique: true,
    },

    device_name: {
      type: "varchar(150)",
    },

    platform: {
      type: "varchar(20)",
    },

    app_version: {
      type: "varchar(30)",
    },

    ip_address: {
      type: "inet",
    },

    user_agent: {
      type: "text",
    },

    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },

    last_used_at: {
      type: "timestamptz",
    },

    expires_at: {
      type: "timestamptz",
      notNull: true,
    },

    revoked_at: {
      type: "timestamptz",
    },
  });

  pgm.addConstraint("user_sessions", "user_sessions_platform_check", {
    check:
      "platform IS NULL OR platform IN ('ios', 'android', 'web', 'unknown')",
  });

  pgm.createIndex("user_sessions", "user_id", {
    name: "user_sessions_user_id_idx",
  });

  pgm.createIndex("user_sessions", "expires_at", {
    name: "user_sessions_expires_at_idx",
  });

  pgm.createIndex("user_sessions", ["user_id", "revoked_at"], {
    name: "user_sessions_user_revoked_at_idx",
  });
};

exports.down = (pgm) => {
  pgm.dropTable("user_sessions");
  pgm.dropTable("login_codes");
};
