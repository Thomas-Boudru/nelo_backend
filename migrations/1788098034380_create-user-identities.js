exports.up = (pgm) => {
  pgm.createTable("user_identities", {
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

    provider: {
      type: "varchar(30)",
      notNull: true,
    },

    provider_subject: {
      type: "varchar(255)",
      notNull: true,
    },

    provider_email: {
      type: "text",
    },

    email_verified_at: {
      type: "timestamptz",
    },

    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },

    last_used_at: {
      type: "timestamptz",
    },
  });

  pgm.addConstraint("user_identities", "user_identities_provider_check", {
    check: "provider IN ('email', 'apple', 'google')",
  });

  pgm.addConstraint(
    "user_identities",
    "user_identities_provider_subject_unique",
    {
      unique: ["provider", "provider_subject"],
    },
  );

  pgm.addConstraint("user_identities", "user_identities_user_provider_unique", {
    unique: ["user_id", "provider"],
  });

  pgm.createIndex("user_identities", "user_id", {
    name: "user_identities_user_id_idx",
  });

  /*
   * Chaque utilisateur existant utilise actuellement la connexion par e-mail.
   * On lui crée donc automatiquement une identité de type "email".
   */
  pgm.sql(`
    INSERT INTO user_identities (
      user_id,
      provider,
      provider_subject,
      provider_email,
      email_verified_at,
      created_at,
      last_used_at
    )
    SELECT
      id,
      'email',
      LOWER(TRIM(email)),
      LOWER(TRIM(email)),
      email_verified_at,
      created_at,
      last_login_at
    FROM users
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("user_identities");
};
