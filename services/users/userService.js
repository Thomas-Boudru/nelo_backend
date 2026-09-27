const pool = require("../../db/pool");

async function getCurrentUser(userId) {
  const result = await pool.query(
    `
      SELECT
        id,
        email,
        display_name,
        locale,
        timezone,
        email_verified_at,
        last_login_at,
        status,
        onboarding_completed_at,
        created_at,
        updated_at
      FROM users
      WHERE id = $1
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [userId],
  );

  if (result.rowCount === 0) {
    const error = new Error("The user could not be found.");
    error.status = 404;
    error.code = "USER_NOT_FOUND";
    throw error;
  }

  const user = result.rows[0];

  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    locale: user.locale,
    timezone: user.timezone,
    emailVerifiedAt: user.email_verified_at,
    lastLoginAt: user.last_login_at,
    status: user.status,
    onboardingCompletedAt: user.onboarding_completed_at,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

async function updatePreferredName(userId, displayName) {
  if (typeof displayName !== "string") {
    const error = new Error("Preferred name must be text.");
    error.status = 400;
    error.code = "INVALID_PREFERRED_NAME";
    throw error;
  }

  const normalizedName = displayName.trim();

  if (normalizedName.length === 0 || normalizedName.length > 80) {
    const error = new Error(
      "Preferred name must contain between 1 and 80 characters.",
    );
    error.status = 400;
    error.code = "INVALID_PREFERRED_NAME";
    throw error;
  }

  const result = await pool.query(
    `
      UPDATE users
      SET display_name = $2,
          updated_at = NOW()
      WHERE id = $1
        AND deleted_at IS NULL
        AND status = 'active'
      RETURNING id
    `,
    [userId, normalizedName],
  );

  if (result.rowCount === 0) {
    const error = new Error("The user could not be found.");
    error.status = 404;
    error.code = "USER_NOT_FOUND";
    throw error;
  }

  return getCurrentUser(userId);
}

async function softDeleteCurrentUser(userId) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      `
        SELECT id
        FROM users
        WHERE id = $1
          AND deleted_at IS NULL
          AND status = 'active'
        FOR UPDATE
      `,
      [userId],
    );

    if (userResult.rowCount === 0) {
      const error = new Error("Account not found.");
      error.code = "USER_NOT_FOUND";
      error.status = 404;
      throw error;
    }

    /*
     * Pour chaque enfant dont cet utilisateur est propriétaire :
     * - compter les autres membres actifs ;
     * - compter les autres propriétaires actifs.
     *
     * Le verrou sur children évite qu'une modification concurrente
     * du profil intervienne pendant cette décision.
     */
    const ownedChildrenResult = await client.query(
      `
        SELECT
          c.id,
          (
            SELECT COUNT(*)::integer
            FROM children_members cm
            INNER JOIN family_members fm
              ON fm.id = cm.family_member_id
            INNER JOIN users u
              ON u.id = fm.user_id
            WHERE cm.child_id = c.id
              AND cm.revoked_at IS NULL
              AND fm.removed_at IS NULL
              AND u.deleted_at IS NULL
              AND u.status = 'active'
              AND u.id <> $1
          ) AS other_members_count,
          (
            SELECT COUNT(*)::integer
            FROM children_members cm
            INNER JOIN family_members fm
              ON fm.id = cm.family_member_id
            INNER JOIN users u
              ON u.id = fm.user_id
            WHERE cm.child_id = c.id
              AND cm.child_role = 'owner'
              AND cm.revoked_at IS NULL
              AND fm.removed_at IS NULL
              AND u.deleted_at IS NULL
              AND u.status = 'active'
              AND u.id <> $1
          ) AS other_owners_count
        FROM children c
        INNER JOIN children_members own_membership
          ON own_membership.child_id = c.id
        INNER JOIN family_members own_family_membership
          ON own_family_membership.id = own_membership.family_member_id
        WHERE own_family_membership.user_id = $1
          AND own_family_membership.removed_at IS NULL
          AND own_membership.revoked_at IS NULL
          AND own_membership.child_role = 'owner'
          AND c.deleted_at IS NULL
        FOR UPDATE OF c
      `,
      [userId],
    );

    const ownedChildren = ownedChildrenResult.rows;

    const childNeedingTransfer = ownedChildren.find(
      (child) =>
        child.other_members_count > 0 && child.other_owners_count === 0,
    );

    if (childNeedingTransfer) {
      const error = new Error(
        "Transfer ownership of your shared child profiles before deleting your account.",
      );
      error.code = "CHILD_OWNERSHIP_TRANSFER_REQUIRED";
      error.status = 409;
      throw error;
    }

    const childrenToDelete = ownedChildren
      .filter((child) => child.other_members_count === 0)
      .map((child) => child.id);

    if (childrenToDelete.length > 0) {
      await client.query(
        `
          UPDATE children
          SET deleted_at = NOW(),
              deleted_by_user_id = $1,
              updated_at = NOW()
          WHERE id = ANY($2::uuid[])
            AND deleted_at IS NULL
        `,
        [userId, childrenToDelete],
      );
    }

    // Retirer cet utilisateur des profils enfant.
    await client.query(
      `
        UPDATE children_members cm
        SET revoked_at = NOW(),
            updated_at = NOW()
        FROM family_members fm
        WHERE cm.family_member_id = fm.id
          AND fm.user_id = $1
          AND cm.revoked_at IS NULL
      `,
      [userId],
    );

    // Retirer cet utilisateur de ses familles.
    await client.query(
      `
        UPDATE family_members
        SET removed_at = NOW(),
            updated_at = NOW()
        WHERE user_id = $1
          AND removed_at IS NULL
      `,
      [userId],
    );

    // Marquer les familles sans membre actif comme supprimées.
    await client.query(
      `
        UPDATE families f
        SET deleted_at = NOW(),
            updated_at = NOW()
        WHERE f.deleted_at IS NULL
          AND f.id IN (
            SELECT family_id
            FROM family_members
            WHERE user_id = $1
          )
          AND NOT EXISTS (
            SELECT 1
            FROM family_members fm
            INNER JOIN users u
              ON u.id = fm.user_id
            WHERE fm.family_id = f.id
              AND fm.removed_at IS NULL
              AND u.deleted_at IS NULL
              AND u.status = 'active'
          )
      `,
      [userId],
    );

    await client.query(
      `
        UPDATE email_change_requests
        SET consumed_at = NOW()
        WHERE user_id = $1
          AND consumed_at IS NULL
      `,
      [userId],
    );

    await client.query(
      `
        UPDATE user_sessions
        SET revoked_at = COALESCE(revoked_at, NOW())
        WHERE user_id = $1
          AND revoked_at IS NULL
      `,
      [userId],
    );

    await client.query(
      `
        UPDATE users
        SET deleted_at = NOW(),
            updated_at = NOW()
        WHERE id = $1
      `,
      [userId],
    );

    await client.query("COMMIT");

    return { deleted: true };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getAccountDeletionCheck(userId) {
  const result = await pool.query(
    `
      SELECT DISTINCT
        c.id AS child_id,
        c.display_name AS child_name
      FROM children c
      JOIN children_members mine
        ON mine.child_id = c.id
       AND mine.revoked_at IS NULL
      JOIN family_members my_family_member
        ON my_family_member.id = mine.family_member_id
       AND my_family_member.user_id = $1
       AND my_family_member.removed_at IS NULL
      WHERE c.deleted_at IS NULL
        AND mine.child_role = 'owner'

        -- Un autre membre conserve l'accès à cet enfant.
        AND EXISTS (
          SELECT 1
          FROM children_members other_member
          JOIN family_members other_family_member
            ON other_family_member.id = other_member.family_member_id
          JOIN users other_user
            ON other_user.id = other_family_member.user_id
          WHERE other_member.child_id = c.id
            AND other_member.revoked_at IS NULL
            AND other_family_member.removed_at IS NULL
            AND other_user.deleted_at IS NULL
            AND other_family_member.user_id <> $1
        )

        -- Aucun autre membre n'est encore propriétaire.
        AND NOT EXISTS (
          SELECT 1
          FROM children_members other_owner
          JOIN family_members other_owner_family_member
            ON other_owner_family_member.id = other_owner.family_member_id
          JOIN users other_owner_user
            ON other_owner_user.id = other_owner_family_member.user_id
          WHERE other_owner.child_id = c.id
            AND other_owner.child_role = 'owner'
            AND other_owner.revoked_at IS NULL
            AND other_owner_family_member.removed_at IS NULL
            AND other_owner_user.deleted_at IS NULL
            AND other_owner_family_member.user_id <> $1
        )
      ORDER BY child_name, child_id
    `,
    [userId],
  );

  return {
    requiresOwnershipTransfer: result.rows.length > 0,
    children: result.rows.map((row) => ({
      id: row.child_id,
      name: row.child_name,
    })),
  };
}

module.exports = {
  getCurrentUser,
  updatePreferredName,
  softDeleteCurrentUser,
  getAccountDeletionCheck,
};
