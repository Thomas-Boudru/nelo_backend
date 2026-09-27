const pool = require("../../db/pool");

function serviceError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

async function makeChildMemberOwner({ childId, childMemberId, actingUserId }) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const childResult = await client.query(
      `
        SELECT id, family_id
        FROM children
        WHERE id = $1
          AND deleted_at IS NULL
        FOR UPDATE
      `,
      [childId],
    );

    if (childResult.rowCount === 0) {
      throw serviceError("CHILD_NOT_FOUND", "Child profile not found.", 404);
    }

    const child = childResult.rows[0];

    const actorResult = await client.query(
      `
        SELECT
          cm.id AS child_member_id,
          cm.child_role,
          fm.family_role
        FROM children_members cm
        INNER JOIN family_members fm
          ON fm.id = cm.family_member_id
        INNER JOIN users u
          ON u.id = fm.user_id
        WHERE cm.child_id = $1
          AND fm.family_id = $2
          AND u.id = $3
          AND cm.revoked_at IS NULL
          AND fm.removed_at IS NULL
          AND u.deleted_at IS NULL
          AND u.status = 'active'
        LIMIT 1
        FOR UPDATE OF cm, fm
      `,
      [childId, child.family_id, actingUserId],
    );

    if (
      actorResult.rowCount === 0 ||
      actorResult.rows[0].child_role !== "owner"
    ) {
      throw serviceError(
        "CHILD_OWNER_REQUIRED",
        "Only a child profile owner can assign another owner.",
        403,
      );
    }

    const targetResult = await client.query(
      `
        SELECT
          cm.id AS child_member_id,
          cm.child_role,
          fm.id AS family_member_id,
          fm.user_id
        FROM children_members cm
        INNER JOIN family_members fm
          ON fm.id = cm.family_member_id
        INNER JOIN users u
          ON u.id = fm.user_id
        WHERE cm.id = $1
          AND cm.child_id = $2
          AND fm.family_id = $3
          AND cm.revoked_at IS NULL
          AND fm.removed_at IS NULL
          AND u.deleted_at IS NULL
          AND u.status = 'active'
        LIMIT 1
        FOR UPDATE OF cm, fm
      `,
      [childMemberId, childId, child.family_id],
    );

    if (targetResult.rowCount === 0) {
      throw serviceError(
        "CHILD_MEMBER_NOT_FOUND",
        "This member does not have access to the child profile.",
        404,
      );
    }

    const target = targetResult.rows[0];

    if (target.user_id === actingUserId) {
      throw serviceError(
        "CANNOT_TRANSFER_TO_SELF",
        "Choose another member of the child profile.",
        400,
      );
    }

    await client.query(
      `
        UPDATE children_members
        SET child_role = 'owner',
            updated_at = NOW()
        WHERE id = $1
      `,
      [target.child_member_id],
    );

    /*
     * Si le propriétaire actuel administre aussi la famille,
     * le nouveau propriétaire reçoit ce rôle familial.
     * Il pourra ainsi gérer les membres après la suppression
     * du compte de l'ancien propriétaire.
     */
    if (actorResult.rows[0].family_role === "owner") {
      await client.query(
        `
          UPDATE family_members
          SET family_role = 'owner',
              updated_at = NOW()
          WHERE id = $1
        `,
        [target.family_member_id],
      );
    }

    await client.query("COMMIT");

    return {
      childMemberId: target.child_member_id,
      childRole: "owner",
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  makeChildMemberOwner,
};
