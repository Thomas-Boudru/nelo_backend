const pool = require("../../db/pool");

const { createSignedDownloadUrl } = require("../storage/r2StorageService");

async function mapChild(row) {
  let avatar = null;

  if (row.avatar_attachment_id && row.avatar_storage_key) {
    avatar = {
      attachmentId: row.avatar_attachment_id,

      url: await createSignedDownloadUrl({
        storageKey: row.avatar_storage_key,
      }),

      cacheKey: `child-avatar:${row.id}:${row.avatar_attachment_id}`,
    };
  }

  return {
    id: row.id,
    displayName: row.display_name,
    birthStatus: row.birth_status,
    birthDate: row.birth_date,
    expectedBirthDate: row.expected_due_date,
    gender: row.sex_at_birth,
    avatar,
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

        COALESCE(
          cmp.theme_mode,
          c.default_theme_mode
        ) AS theme_mode,

        avatar.id AS avatar_attachment_id,
        avatar.storage_key AS avatar_storage_key

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

      ORDER BY
        c.created_at ASC,
        c.id ASC
    `,
    [userId],
  );

  return Promise.all(result.rows.map(mapChild));
}

module.exports = {
  getAccessibleChildren,
};
