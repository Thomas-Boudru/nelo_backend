exports.up = (pgm) => {
  pgm.createTable("user_notification_preferences", {
    user_id: {
      type: "uuid",
      primaryKey: true,
      references: "users(id)",
      onDelete: "CASCADE",
    },
    notifications_enabled: {
      type: "boolean",
      notNull: true,
      default: true,
    },
    tracking_reminders_enabled: {
      type: "boolean",
      notNull: true,
      default: false,
    },
    daily_tip_enabled: {
      type: "boolean",
      notNull: true,
      default: true,
    },
    invitation_accepted_enabled: {
      type: "boolean",
      notNull: true,
      default: true,
    },
    important_shared_activity_enabled: {
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

  pgm.sql(`
    INSERT INTO user_notification_preferences (user_id)
    SELECT id FROM users
    ON CONFLICT (user_id) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("user_notification_preferences");
};
