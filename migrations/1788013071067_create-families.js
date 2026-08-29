exports.up = (pgm) => {
  pgm.createTable("families", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },

    created_by_user_id: {
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

    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },

    deleted_at: {
      type: "timestamptz",
    },
  });

  pgm.createIndex("families", "created_by_user_id", {
    name: "families_created_by_user_id_idx",
  });

  pgm.createTable("family_members", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },

    family_id: {
      type: "uuid",
      notNull: true,
      references: "families",
      onDelete: "CASCADE",
    },

    user_id: {
      type: "uuid",
      notNull: true,
      references: "users",
      onDelete: "CASCADE",
    },

    family_role: {
      type: "varchar(20)",
      notNull: true,
      default: "contributor",
    },

    joined_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },

    created_by_user_id: {
      type: "uuid",
      references: "users",
      onDelete: "SET NULL",
    },

    removed_at: {
      type: "timestamptz",
    },

    removed_by_user_id: {
      type: "uuid",
      references: "users",
      onDelete: "SET NULL",
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

  pgm.addConstraint("family_members", "family_members_role_check", {
    check: "family_role IN ('owner', 'contributor')",
  });

  pgm.createIndex("family_members", ["family_id", "user_id"], {
    name: "family_members_family_user_unique_active_idx",
    unique: true,
    where: "removed_at IS NULL",
  });

  pgm.createIndex("family_members", "user_id", {
    name: "family_members_user_id_active_idx",
    where: "removed_at IS NULL",
  });
};

exports.down = (pgm) => {
  pgm.dropTable("family_members");
  pgm.dropTable("families");
};
