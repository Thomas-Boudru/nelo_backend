const pool = require("../../db/pool");

function mapChild(row) {
  return {
    id: row.id,
    displayName: row.display_name,
    birthStatus: row.birth_status,
    birthDate: row.birth_date,
    expectedBirthDate: row.expected_due_date,
    gender: row.sex_at_birth,
    avatar: row.avatar_attachment_id
      ? {
          attachmentId: row.avatar_attachment_id,
        }
      : null,
    themeMode: row.theme_mode,
    familyId: row.family_id,
    role: row.child_role,
    updatedAt: row.updated_at,
  };
}

async function getAccessibleChildren(userId) {
  const result = await pool.query(
    `
      SELECT
        c.id,
        c.display_name,
        c.birth_status,
        c.birth_date,
        c.expected_due_date,
        c.sex_at_birth,
        c.family_id,
        c.updated_at,

        cm.child_role,

        COALESCE(cmp.theme_mode, c.default_theme_mode) AS theme_mode,

        avatar.id AS avatar_attachment_id

      FROM family_members fm

      INNER JOIN families f
        ON f.id = fm.family_id
        AND f.deleted_at IS NULL

      INNER JOIN children_members cm
        ON cm.family_member_id = fm.id
        AND cm.revoked_at IS NULL

      INNER JOIN children c
        ON c.id = cm.child_id
        AND c.family_id = f.id
        AND c.deleted_at IS NULL

      LEFT JOIN children_member_preferences cmp
        ON cmp.child_member_id = cm.id

      LEFT JOIN attachments avatar
        ON avatar.id = c.avatar_attachment_id
        AND avatar.deleted_at IS NULL

      WHERE fm.user_id = $1
        AND fm.removed_at IS NULL

      ORDER BY c.created_at ASC, c.id ASC
    `,
    [userId],
  );

  return result.rows.map(mapChild);
}

module.exports = {
  getAccessibleChildren,
};
