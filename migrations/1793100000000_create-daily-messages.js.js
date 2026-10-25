exports.up = (pgm) => {
  // 1. Daily message catalog
  pgm.createTable("daily_messages", {
    id: {
      type: "text",
      primaryKey: true,
    },
    category: {
      type: "text",
      notNull: true,
    },
    illustration: {
      type: "text",
      notNull: true,
    },
    min_age_days: {
      type: "integer",
      notNull: true,
      default: 0,
    },
    max_age_days: {
      type: "integer",
      notNull: true,
      default: 548,
    },
    tags: {
      type: "jsonb",
      notNull: true,
      default: "[]",
    },
    priority: {
      type: "integer",
      notNull: true,
      default: 1,
    },
    is_active: {
      type: "boolean",
      notNull: true,
      default: true,
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("CURRENT_TIMESTAMP"),
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("CURRENT_TIMESTAMP"),
    },
  });

  pgm.addConstraint("daily_messages", "daily_messages_age_check", {
    check: "min_age_days >= 0 AND max_age_days >= min_age_days",
  });

  pgm.addConstraint("daily_messages", "daily_messages_priority_check", {
    check: "priority >= 0",
  });

  pgm.createIndex("daily_messages", [
    "is_active",
    "min_age_days",
    "max_age_days",
  ]);

  pgm.createIndex("daily_messages", "category");

  // 2. Translations
  pgm.createTable("daily_message_translations", {
    message_id: {
      type: "text",
      notNull: true,
      references: "daily_messages(id)",
      onDelete: "CASCADE",
    },
    language_code: {
      type: "text",
      notNull: true,
    },
    title: {
      type: "text",
      notNull: true,
    },
    summary: {
      type: "text",
      notNull: true,
    },
    sections: {
      type: "jsonb",
      notNull: true,
      default: "[]",
    },
    sources: {
      type: "jsonb",
      notNull: true,
      default: "[]",
    },
    ask_nelo_prompt: {
      type: "text",
    },
  });

  pgm.addConstraint(
    "daily_message_translations",
    "daily_message_translations_pkey",
    {
      primaryKey: ["message_id", "language_code"],
    },
  );

  pgm.addConstraint(
    "daily_message_translations",
    "daily_message_translations_language_check",
    {
      check: "language_code IN ('en', 'fr', 'de', 'es', 'it', 'nl', 'pt')",
    },
  );

  // 3. Daily message assigned to each child
  pgm.createTable("child_daily_messages", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    child_id: {
      type: "uuid",
      notNull: true,
      references: "children(id)",
      onDelete: "CASCADE",
    },
    message_id: {
      type: "text",
      notNull: true,
      references: "daily_messages(id)",
      onDelete: "RESTRICT",
    },
    message_date: {
      type: "date",
      notNull: true,
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("CURRENT_TIMESTAMP"),
    },
  });

  pgm.addConstraint(
    "child_daily_messages",
    "child_daily_messages_child_date_unique",
    {
      unique: ["child_id", "message_date"],
    },
  );

  pgm.createIndex("child_daily_messages", ["child_id", "message_date"], {
    name: "idx_child_daily_messages_history",
    method: "btree",
  });

  pgm.createIndex("child_daily_messages", ["child_id", "message_id"]);
};

exports.down = (pgm) => {
  pgm.dropTable("child_daily_messages");
  pgm.dropTable("daily_message_translations");
  pgm.dropTable("daily_messages");
};
