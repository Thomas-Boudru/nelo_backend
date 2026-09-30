const pool = require("../../db/pool");

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createTrackingError(code, message, status) {
  const error = new Error(message);

  error.code = code;
  error.status = status;

  return error;
}

function validateUuid(value, fieldName) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw createTrackingError("INVALID_ID", `Invalid ${fieldName}.`, 400);
  }
}

async function requireChildTrackingAccess({
  childId,
  userId,
  write = false,
  database = pool,
}) {
  validateUuid(childId, "child ID");

  if (!userId) {
    throw createTrackingError(
      "UNAUTHENTICATED",
      "Authentication is required.",
      401,
    );
  }

  validateUuid(userId, "user ID");

  const result = await database.query(
    `
      SELECT
        c.id AS child_id,
        cm.id AS child_member_id,
        cm.child_role
      FROM children c
      INNER JOIN children_members cm
        ON cm.child_id = c.id
        AND cm.revoked_at IS NULL
      INNER JOIN family_members fm
        ON fm.id = cm.family_member_id
        AND fm.user_id = $2
        AND fm.removed_at IS NULL
      WHERE c.id = $1
        AND c.deleted_at IS NULL
    `,
    [childId, userId],
  );

  if (result.rowCount === 0) {
    throw createTrackingError("CHILD_NOT_FOUND", "Child not found.", 404);
  }

  const membership = result.rows[0];

  const canWrite = ["owner", "contributor"].includes(membership.child_role);

  if (write && !canWrite) {
    throw createTrackingError(
      "TRACKING_ACCESS_DENIED",
      "You are not allowed to modify this child's tracking.",
      403,
    );
  }

  return {
    childId: membership.child_id,
    childMemberId: membership.child_member_id,
    role: membership.child_role,
    canWrite,
  };
}

module.exports = {
  createTrackingError,
  validateUuid,
  requireChildTrackingAccess,
};
