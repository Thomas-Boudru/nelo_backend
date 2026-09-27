exports.up = (pgm) => {
  pgm.createTable("user_preferences", {
    user_id: {
      type: "uuid",
      primaryKey: true,
      references: "users(id)",
      onDelete: "CASCADE",
    },

    // NULL = utiliser la langue de l'appareil.
    language_code: {
      type: "varchar(10)",
      default: null,
    },

    weight_unit: {
      type: "varchar(10)",
      notNull: true,
      default: "kg",
    },

    length_unit: {
      type: "varchar(10)",
      notNull: true,
      default: "cm",
    },

    temperature_unit: {
      type: "varchar(10)",
      notNull: true,
      default: "c",
    },

    analytics_enabled: {
      type: "boolean",
      notNull: true,
      default: false,
    },

    crash_reports_enabled: {
      type: "boolean",
      notNull: true,
      default: false,
    },

    ai_improvement_enabled: {
      type: "boolean",
      notNull: true,
      default: false,
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
  });

  // Préférences par défaut pour les comptes qui existent déjà.
  pgm.sql(`
    INSERT INTO user_preferences (user_id)
    SELECT id
    FROM users
    ON CONFLICT (user_id) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("user_preferences");
};
