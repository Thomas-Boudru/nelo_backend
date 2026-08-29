exports.up = (pgm) => {
  pgm.createTable("children", {
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

    display_name: {
      type: "varchar(100)",
      notNull: true,
    },

    birth_status: {
      type: "varchar(20)",
      notNull: true,
    },

    birth_date: {
      type: "date",
    },

    birth_time: {
      type: "time",
    },

    expected_due_date: {
      type: "date",
    },

    sex_at_birth: {
      type: "varchar(20)",
    },

    gestational_age_weeks: {
      type: "smallint",
    },

    gestational_age_days: {
      type: "smallint",
    },

    avatar_attachment_id: {
      type: "uuid",
      references: "attachments",
      onDelete: "SET NULL",
    },

    default_theme_mode: {
      type: "varchar(20)",
      notNull: true,
      default: "light",
    },

    created_by_user_id: {
      type: "uuid",
      notNull: true,
      references: "users",
      onDelete: "RESTRICT",
    },

    updated_by_user_id: {
      type: "uuid",
      references: "users",
      onDelete: "SET NULL",
    },

    deleted_by_user_id: {
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

    deleted_at: {
      type: "timestamptz",
    },
  });

  pgm.addConstraint("children", "children_birth_status_check", {
    check: "birth_status IN ('born', 'expected')",
  });

  pgm.addConstraint("children", "children_birth_information_check", {
    check: `
      (
        birth_status = 'born'
        AND birth_date IS NOT NULL
      )
      OR
      (
        birth_status = 'expected'
        AND birth_date IS NULL
        AND expected_due_date IS NOT NULL
      )
    `,
  });

  pgm.addConstraint("children", "children_sex_at_birth_check", {
    check: `
      sex_at_birth IS NULL
      OR sex_at_birth IN (
        'female',
        'male',
        'intersex',
        'unspecified'
      )
    `,
  });

  pgm.addConstraint("children", "children_gestational_age_weeks_check", {
    check: `
      gestational_age_weeks IS NULL
      OR gestational_age_weeks BETWEEN 20 AND 45
    `,
  });

  pgm.addConstraint("children", "children_gestational_age_days_check", {
    check: `
      gestational_age_days IS NULL
      OR gestational_age_days BETWEEN 0 AND 6
    `,
  });

  pgm.createIndex("children", "family_id", {
    name: "children_family_id_active_idx",
    where: "deleted_at IS NULL",
  });

  pgm.createIndex("children", "avatar_attachment_id", {
    name: "children_avatar_attachment_id_idx",
    where: "avatar_attachment_id IS NOT NULL",
  });

  pgm.createTable("children_members", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },

    child_id: {
      type: "uuid",
      notNull: true,
      references: "children",
      onDelete: "CASCADE",
    },

    family_member_id: {
      type: "uuid",
      notNull: true,
      references: "family_members",
      onDelete: "CASCADE",
    },

    child_role: {
      type: "varchar(20)",
      notNull: true,
      default: "contributor",
    },

    relationship_type: {
      type: "varchar(30)",
    },

    relationship_label: {
      type: "varchar(50)",
    },

    created_by_user_id: {
      type: "uuid",
      notNull: true,
      references: "users",
      onDelete: "RESTRICT",
    },

    joined_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },

    revoked_at: {
      type: "timestamptz",
    },

    revoked_by_user_id: {
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

  pgm.addConstraint("children_members", "children_members_role_check", {
    check: "child_role IN ('owner', 'contributor')",
  });

  pgm.addConstraint(
    "children_members",
    "children_members_relationship_type_check",
    {
      check: `
        relationship_type IS NULL
        OR relationship_type IN (
          'parent',
          'grandparent',
          'family',
          'friend',
          'other'
        )
      `,
    },
  );

  pgm.addConstraint(
    "children_members",
    "children_members_relationship_label_check",
    {
      check: `
        relationship_type = 'other'
        OR relationship_label IS NULL
      `,
    },
  );

  pgm.createIndex("children_members", ["child_id", "family_member_id"], {
    name: "children_members_child_family_member_unique_active_idx",
    unique: true,
    where: "revoked_at IS NULL",
  });

  pgm.createIndex("children_members", "family_member_id", {
    name: "children_members_family_member_id_active_idx",
    where: "revoked_at IS NULL",
  });

  pgm.createTable("children_member_preferences", {
    child_member_id: {
      type: "uuid",
      primaryKey: true,
      references: "children_members",
      onDelete: "CASCADE",
    },

    theme_mode: {
      type: "varchar(20)",
    },

    visible_tracking_types: {
      type: "text[]",
    },

    visible_feeding_methods: {
      type: "text[]",
    },

    default_bottle_preset_id: {
      type: "text",
    },

    default_milk_type: {
      type: "varchar(30)",
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
};

exports.down = (pgm) => {
  pgm.dropTable("children_member_preferences");
  pgm.dropTable("children_members");
  pgm.dropTable("children");
};
