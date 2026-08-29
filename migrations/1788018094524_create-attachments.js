exports.up = (pgm) => {
  pgm.createTable("attachments", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },

    storage_key: {
      type: "text",
      notNull: true,
      unique: true,
    },

    original_filename: {
      type: "varchar(255)",
    },

    mime_type: {
      type: "varchar(100)",
      notNull: true,
    },

    size_bytes: {
      type: "bigint",
      notNull: true,
    },

    width: {
      type: "integer",
    },

    height: {
      type: "integer",
    },

    uploaded_by_user_id: {
      type: "uuid",
      notNull: true,
      references: "users",
      onDelete: "RESTRICT",
    },

    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },

    deleted_at: {
      type: "timestamptz",
    },
  });

  pgm.addConstraint("attachments", "attachments_size_bytes_check", {
    check: "size_bytes > 0",
  });

  pgm.addConstraint("attachments", "attachments_dimensions_check", {
    check: `
      (width IS NULL AND height IS NULL)
      OR
      (width > 0 AND height > 0)
    `,
  });

  pgm.createIndex("attachments", "uploaded_by_user_id", {
    name: "attachments_uploaded_by_user_id_active_idx",
    where: "deleted_at IS NULL",
  });
};

exports.down = (pgm) => {
  pgm.dropTable("attachments");
};
