exports.up = (pgm) => {
  pgm.createTable("email_change_requests", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(id)",
      onDelete: "CASCADE",
    },
    new_email: {
      type: "text",
      notNull: true,
    },
    code_hash: {
      type: "text",
      notNull: true,
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
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.createIndex("email_change_requests", ["user_id", "created_at"], {
    name: "email_change_requests_user_created_idx",
  });
};

exports.down = (pgm) => {
  pgm.dropTable("email_change_requests");
};
