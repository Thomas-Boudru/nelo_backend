exports.up = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS public.family_members_user_unique_active_owner_idx;
  `);
};

exports.down = (pgm) => {
  pgm.createIndex("family_members", "user_id", {
    name: "family_members_user_unique_active_owner_idx",
    unique: true,
    where: "removed_at IS NULL AND family_role = 'owner'",
  });
};
