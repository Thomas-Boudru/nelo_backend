exports.up = (pgm) => {
  pgm.createTable("oauth_credentials", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },

    user_identity_id: {
      type: "uuid",
      notNull: true,
      unique: true,
      references: "user_identities",
      onDelete: "CASCADE",
    },

    encrypted_refresh_token: {
      type: "text",
      notNull: true,
    },

    encryption_iv: {
      type: "varchar(24)",
      notNull: true,
    },

    encryption_auth_tag: {
      type: "varchar(32)",
      notNull: true,
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

    revoked_at: {
      type: "timestamptz",
    },
  });

  pgm.createIndex("oauth_credentials", "user_identity_id", {
    name: "oauth_credentials_user_identity_id_idx",
  });
};

exports.down = (pgm) => {
  pgm.dropTable("oauth_credentials");
};
