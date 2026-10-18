const pool = require("../../db/pool");

const {
  getFamilyEntitlements,
} = require("../billing/familyEntitlementsService");

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function accessError(code, message, status, details) {
  const error = new Error(message);

  error.code = code;
  error.status = status;

  if (details) {
    error.details = details;
  }

  return error;
}

async function requireNeloPhotoAccess({
  childId,
  conversationId,
  userId,
  database = pool,
}) {
  for (const value of [childId, conversationId, userId]) {
    if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
      throw accessError(
        "INVALID_REQUEST",
        "Valid child, conversation and user IDs are required.",
        400,
      );
    }
  }

  const result = await database.query(
    `
      SELECT
        nc.family_id,
        nc.status

      FROM nelo_conversations nc

      JOIN children c
        ON c.id = nc.child_id
        AND c.family_id = nc.family_id
        AND c.deleted_at IS NULL

      JOIN families f
        ON f.id = nc.family_id
        AND f.deleted_at IS NULL

      JOIN users u
        ON u.id = nc.user_id
        AND u.deleted_at IS NULL
        AND u.status = 'active'

      WHERE nc.id = $1::uuid
        AND nc.child_id = $2::uuid
        AND nc.user_id = $3::uuid
        AND nc.deleted_at IS NULL

        AND EXISTS (
          SELECT 1

          FROM children_members cm

          JOIN family_members fm
            ON fm.id = cm.family_member_id
            AND fm.family_id = nc.family_id
            AND fm.user_id = nc.user_id
            AND fm.removed_at IS NULL

          WHERE cm.child_id = nc.child_id
            AND cm.revoked_at IS NULL
        )

      LIMIT 1
    `,
    [conversationId, childId, userId],
  );

  const conversation = result.rows[0];

  if (!conversation) {
    throw accessError(
      "CONVERSATION_NOT_FOUND",
      "The conversation could not be found.",
      404,
    );
  }

  if (conversation.status !== "active") {
    throw accessError(
      "CONVERSATION_ARCHIVED",
      "This conversation is archived.",
      409,
    );
  }

  const entitlements = await getFamilyEntitlements({
    familyId: conversation.family_id,
    userId,
    database,
  });

  const feature = entitlements.features?.assistant_attachments;

  // Une configuration absente ne doit pas être interprétée
  // comme une invitation à acheter Premium.
  if (!feature || typeof feature.enabled !== "boolean") {
    throw accessError(
      "SUBSCRIPTION_PLAN_NOT_CONFIGURED",
      "Photo access is not configured correctly.",
      500,
    );
  }

  if (!feature.enabled) {
    throw accessError(
      "FEATURE_NOT_AVAILABLE",
      "Sending photos to Nelo is available with Nelo Premium.",
      403,
      {
        featureCode: "assistant_attachments",
        planCode: entitlements.planCode,
      },
    );
  }

  return {
    familyId: conversation.family_id,
    entitlements,
  };
}

module.exports = {
  requireNeloPhotoAccess,
};
