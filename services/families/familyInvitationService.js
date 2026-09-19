const crypto = require("crypto");

const pool = require("../../db/pool");

const { sendFamilyInvitationEmail } = require("../email/emailService");

const INVITATION_DURATION_DAYS = 7;

function createServiceError(code, message, status) {
  const error = new Error(message);

  error.code = code;
  error.status = status;

  return error;
}

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || ""),
  );
}

function createInvitationToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashInvitationToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function createInvitationUrl(token) {
  if (!process.env.FAMILY_INVITATION_BASE_URL) {
    throw new Error("Missing FAMILY_INVITATION_BASE_URL environment variable.");
  }

  const invitationUrl = new URL(process.env.FAMILY_INVITATION_BASE_URL);

  invitationUrl.searchParams.set("token", token);

  return invitationUrl.toString();
}

function mapInvitation(row, inviteUrl) {
  return {
    id: row.id,
    familyId: row.family_id,
    childId: row.child_id,
    email: row.email,
    childRole: row.child_role,
    relationshipType: row.relationship_type,
    relationshipLabel: row.relationship_label,
    inviteUrl,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

async function createFamilyInvitation({ childId, userId, email, locale }) {
  if (!isValidUuid(childId)) {
    throw createServiceError(
      "INVALID_CHILD_ID",
      "The child ID is invalid.",
      400,
    );
  }

  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    throw createServiceError(
      "MISSING_INVITATION_EMAIL",
      "An email address is required.",
      400,
    );
  }

  if (!isValidEmail(normalizedEmail)) {
    throw createServiceError(
      "INVALID_INVITATION_EMAIL",
      "The email address is invalid.",
      400,
    );
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    /*
     * Verrouille l'enfant pendant la création de l'invitation et vérifie :
     * - que l'enfant existe encore ;
     * - que l'utilisateur est membre actif ;
     * - que son rôle sur cet enfant est owner.
     */
    const childResult = await client.query(
      `
        SELECT
          c.id,
          c.family_id,
          c.display_name,
          u.email AS inviter_email,
          u.display_name AS inviter_name
        FROM children c
        INNER JOIN children_members cm
          ON cm.child_id = c.id
          AND cm.revoked_at IS NULL
        INNER JOIN family_members fm
          ON fm.id = cm.family_member_id
          AND fm.family_id = c.family_id
          AND fm.removed_at IS NULL
        INNER JOIN users u
          ON u.id = fm.user_id
          AND u.deleted_at IS NULL
          AND u.status = 'active'
        WHERE c.id = $1
          AND c.deleted_at IS NULL
          AND fm.user_id = $2
          AND cm.child_role = 'owner'
        LIMIT 1
        FOR UPDATE OF c
      `,
      [childId, userId],
    );

    if (childResult.rowCount === 0) {
      throw createServiceError(
        "CHILD_NOT_FOUND_OR_FORBIDDEN",
        "The child was not found or you cannot invite members to this profile.",
        403,
      );
    }

    const child = childResult.rows[0];

    if (normalizeEmail(child.inviter_email) === normalizedEmail) {
      throw createServiceError(
        "CANNOT_INVITE_YOURSELF",
        "You cannot invite yourself to this child profile.",
        409,
      );
    }

    /*
     * Vérifie si un utilisateur possédant cette adresse a déjà
     * un accès actif à l'enfant.
     */
    const existingMemberResult = await client.query(
      `
        SELECT cm.id
        FROM users u
        INNER JOIN family_members fm
          ON fm.user_id = u.id
          AND fm.family_id = $1
          AND fm.removed_at IS NULL
        INNER JOIN children_members cm
          ON cm.family_member_id = fm.id
          AND cm.child_id = $2
          AND cm.revoked_at IS NULL
        WHERE u.email = $3
          AND u.deleted_at IS NULL
          AND u.status = 'active'
        LIMIT 1
      `,
      [child.family_id, child.id, normalizedEmail],
    );

    if (existingMemberResult.rowCount > 0) {
      throw createServiceError(
        "MEMBER_ALREADY_HAS_ACCESS",
        "This person already has access to the child profile.",
        409,
      );
    }

    /*
     * Toute ancienne invitation non acceptée devient invalide.
     *
     * Cela couvre :
     * - une invitation expirée ;
     * - un renvoi volontaire ;
     * - un double envoi depuis l'application.
     *
     * Le nouveau token remplacera toujours l'ancien.
     */
    await client.query(
      `
        UPDATE family_invitations
        SET revoked_at = NOW()
        WHERE child_id = $1
          AND email = $2
          AND accepted_at IS NULL
          AND revoked_at IS NULL
      `,
      [child.id, normalizedEmail],
    );

    const rawToken = createInvitationToken();
    const tokenHash = hashInvitationToken(rawToken);
    const inviteUrl = createInvitationUrl(rawToken);

    const invitationResult = await client.query(
      `
        INSERT INTO family_invitations (
          family_id,
          child_id,
          invited_by_user_id,
          email,
          child_role,
          relationship_type,
          relationship_label,
          token_hash,
          expires_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          'contributor',
          NULL,
          NULL,
          $5,
          NOW() + ($6 * INTERVAL '1 day')
        )
        RETURNING
          id,
          family_id,
          child_id,
          email,
          child_role,
          relationship_type,
          relationship_label,
          expires_at,
          created_at
      `,
      [
        child.family_id,
        child.id,
        userId,
        normalizedEmail,
        tokenHash,
        INVITATION_DURATION_DAYS,
      ],
    );

    const invitation = invitationResult.rows[0];

    /*
     * L'email est envoyé avant COMMIT.
     * Si Resend échoue, l'invitation n'est pas conservée dans la base.
     */
    await sendFamilyInvitationEmail({
      email: normalizedEmail,
      inviterName: child.inviter_name || child.inviter_email.split("@")[0],
      childName: child.display_name,
      inviteUrl,
      locale,
    });

    await client.query("COMMIT");

    return mapInvitation(invitation, inviteUrl);
  } catch (error) {
    await client.query("ROLLBACK");

    if (
      error.code === "23505" &&
      error.constraint === "family_invitations_child_email_unique_pending_idx"
    ) {
      throw createServiceError(
        "INVITATION_ALREADY_PENDING",
        "An invitation is already pending for this email address.",
        409,
      );
    }

    throw error;
  } finally {
    client.release();
  }
}

async function getFamilyInvitationPreview({ token }) {
  const normalizedToken = String(token || "").trim();

  /*
   * Un token créé avec randomBytes(32).toString("base64url")
   * contient normalement 43 caractères.
   */
  if (!normalizedToken || !/^[A-Za-z0-9_-]{43}$/.test(normalizedToken)) {
    throw createServiceError(
      "INVALID_INVITATION_TOKEN",
      "The invitation link is invalid.",
      400,
    );
  }

  const tokenHash = hashInvitationToken(normalizedToken);

  const invitationResult = await pool.query(
    `
      SELECT
        fi.accepted_at,
        fi.revoked_at,
        fi.expires_at,

        c.display_name AS child_name,

        NULLIF(
          TRIM(inviter.display_name),
          ''
        ) AS inviter_name

      FROM family_invitations fi

      INNER JOIN families f
        ON f.id = fi.family_id
        AND f.deleted_at IS NULL

      INNER JOIN children c
        ON c.id = fi.child_id
        AND c.family_id = fi.family_id
        AND c.deleted_at IS NULL

      LEFT JOIN users inviter
        ON inviter.id = fi.invited_by_user_id
        AND inviter.deleted_at IS NULL
        AND inviter.status = 'active'

      WHERE fi.token_hash = $1

      LIMIT 1
    `,
    [tokenHash],
  );

  if (invitationResult.rowCount === 0) {
    throw createServiceError(
      "INVITATION_NOT_FOUND",
      "The invitation link is invalid.",
      404,
    );
  }

  const invitation = invitationResult.rows[0];

  let status = "pending";

  if (invitation.accepted_at) {
    status = "accepted";
  } else if (invitation.revoked_at) {
    status = "revoked";
  } else if (new Date(invitation.expires_at).getTime() <= Date.now()) {
    status = "expired";
  }

  return {
    status,
    inviterFirstName: invitation.inviter_name || null,
    childFirstName: invitation.child_name,
    expiresAt: invitation.expires_at,
  };
}

async function resendFamilyInvitation({
  childId,
  invitationId,
  userId,
  locale,
}) {
  if (!isValidUuid(childId)) {
    throw createServiceError(
      "INVALID_CHILD_ID",
      "The child ID is invalid.",
      400,
    );
  }

  if (!isValidUuid(invitationId)) {
    throw createServiceError(
      "INVALID_INVITATION_ID",
      "The invitation ID is invalid.",
      400,
    );
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    /*
     * Vérifie que l'utilisateur connecté est propriétaire de l'enfant.
     * L'enfant est verrouillé pendant le renouvellement de l'invitation.
     */
    const childResult = await client.query(
      `
        SELECT
          c.id,
          c.family_id,
          c.display_name,
          u.email AS inviter_email,
          u.display_name AS inviter_name
        FROM children c
        INNER JOIN children_members cm
          ON cm.child_id = c.id
          AND cm.revoked_at IS NULL
        INNER JOIN family_members fm
          ON fm.id = cm.family_member_id
          AND fm.family_id = c.family_id
          AND fm.removed_at IS NULL
        INNER JOIN users u
          ON u.id = fm.user_id
          AND u.deleted_at IS NULL
          AND u.status = 'active'
        WHERE c.id = $1
          AND c.deleted_at IS NULL
          AND fm.user_id = $2
          AND cm.child_role = 'owner'
        LIMIT 1
        FOR UPDATE OF c
      `,
      [childId, userId],
    );

    if (childResult.rowCount === 0) {
      throw createServiceError(
        "CHILD_NOT_FOUND_OR_FORBIDDEN",
        "The child was not found or you cannot manage invitations for this profile.",
        403,
      );
    }

    const child = childResult.rows[0];

    /*
     * Verrouille l'invitation pour empêcher deux renvois simultanés.
     * On ne filtre pas ici sur revoked_at ou accepted_at afin de pouvoir
     * retourner une erreur précise.
     */
    const invitationResult = await client.query(
      `
        SELECT
          id,
          family_id,
          child_id,
          email,
          child_role,
          relationship_type,
          relationship_label,
          accepted_at,
          revoked_at,
          expires_at,
          created_at
        FROM family_invitations
        WHERE id = $1
          AND child_id = $2
          AND family_id = $3
        LIMIT 1
        FOR UPDATE
      `,
      [invitationId, child.id, child.family_id],
    );

    if (invitationResult.rowCount === 0) {
      throw createServiceError(
        "INVITATION_NOT_FOUND",
        "The invitation was not found.",
        404,
      );
    }

    const existingInvitation = invitationResult.rows[0];

    if (existingInvitation.accepted_at) {
      throw createServiceError(
        "INVITATION_ALREADY_ACCEPTED",
        "This invitation has already been accepted.",
        409,
      );
    }

    if (existingInvitation.revoked_at) {
      throw createServiceError(
        "INVITATION_ALREADY_REVOKED",
        "This invitation has already been cancelled.",
        409,
      );
    }

    /*
     * Le token précédent devient immédiatement invalide.
     * L'identifiant de l'invitation reste identique.
     */
    const rawToken = createInvitationToken();
    const tokenHash = hashInvitationToken(rawToken);
    const inviteUrl = createInvitationUrl(rawToken);

    const updatedInvitationResult = await client.query(
      `
        UPDATE family_invitations
        SET
          token_hash = $1,
          expires_at = NOW() + ($2 * INTERVAL '1 day'),
          invited_by_user_id = $3
        WHERE id = $4
        RETURNING
          id,
          family_id,
          child_id,
          email,
          child_role,
          relationship_type,
          relationship_label,
          expires_at,
          created_at
      `,
      [tokenHash, INVITATION_DURATION_DAYS, userId, existingInvitation.id],
    );

    const updatedInvitation = updatedInvitationResult.rows[0];

    /*
     * Si l'envoi échoue, le changement de token est annulé.
     * L'ancien token reste donc utilisable jusqu'à son expiration.
     */
    await sendFamilyInvitationEmail({
      email: updatedInvitation.email,
      inviterName: child.inviter_name || child.inviter_email.split("@")[0],
      childName: child.display_name,
      inviteUrl,
      locale,
    });

    await client.query("COMMIT");

    return mapInvitation(updatedInvitation, inviteUrl);
  } catch (error) {
    await client.query("ROLLBACK");

    throw error;
  } finally {
    client.release();
  }
}

async function revokeFamilyInvitation({ childId, invitationId, userId }) {
  if (!isValidUuid(childId)) {
    throw createServiceError(
      "INVALID_CHILD_ID",
      "The child ID is invalid.",
      400,
    );
  }

  if (!isValidUuid(invitationId)) {
    throw createServiceError(
      "INVALID_INVITATION_ID",
      "The invitation ID is invalid.",
      400,
    );
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    /*
     * Vérifie que l'utilisateur connecté est propriétaire de l'enfant.
     */
    const childResult = await client.query(
      `
        SELECT
          c.id,
          c.family_id
        FROM children c
        INNER JOIN children_members cm
          ON cm.child_id = c.id
          AND cm.revoked_at IS NULL
        INNER JOIN family_members fm
          ON fm.id = cm.family_member_id
          AND fm.family_id = c.family_id
          AND fm.removed_at IS NULL
        WHERE c.id = $1
          AND c.deleted_at IS NULL
          AND fm.user_id = $2
          AND cm.child_role = 'owner'
        LIMIT 1
        FOR UPDATE OF c
      `,
      [childId, userId],
    );

    if (childResult.rowCount === 0) {
      throw createServiceError(
        "CHILD_NOT_FOUND_OR_FORBIDDEN",
        "The child was not found or you cannot manage invitations for this profile.",
        403,
      );
    }

    const child = childResult.rows[0];

    const invitationResult = await client.query(
      `
        SELECT
          id,
          accepted_at,
          revoked_at
        FROM family_invitations
        WHERE id = $1
          AND child_id = $2
          AND family_id = $3
        LIMIT 1
        FOR UPDATE
      `,
      [invitationId, child.id, child.family_id],
    );

    if (invitationResult.rowCount === 0) {
      throw createServiceError(
        "INVITATION_NOT_FOUND",
        "The invitation was not found.",
        404,
      );
    }

    const invitation = invitationResult.rows[0];

    if (invitation.accepted_at) {
      throw createServiceError(
        "INVITATION_ALREADY_ACCEPTED",
        "This invitation has already been accepted.",
        409,
      );
    }

    if (invitation.revoked_at) {
      throw createServiceError(
        "INVITATION_ALREADY_REVOKED",
        "This invitation has already been cancelled.",
        409,
      );
    }

    const revokedInvitationResult = await client.query(
      `
        UPDATE family_invitations
        SET revoked_at = NOW()
        WHERE id = $1
        RETURNING
          id,
          child_id,
          email,
          revoked_at
      `,
      [invitation.id],
    );

    await client.query("COMMIT");

    const revokedInvitation = revokedInvitationResult.rows[0];

    return {
      id: revokedInvitation.id,
      childId: revokedInvitation.child_id,
      email: revokedInvitation.email,
      revokedAt: revokedInvitation.revoked_at,
    };
  } catch (error) {
    await client.query("ROLLBACK");

    throw error;
  } finally {
    client.release();
  }
}

async function getChildSharing({ childId, userId }) {
  if (!isValidUuid(childId)) {
    throw createServiceError(
      "INVALID_CHILD_ID",
      "The child ID is invalid.",
      400,
    );
  }

  const client = await pool.connect();

  try {
    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );

    /*
     * Vérifie que l'utilisateur possède toujours un accès actif à l'enfant
     * et récupère son rôle.
     */
    const accessResult = await client.query(
      `
        SELECT
          c.id AS child_id,
          c.family_id,
          cm.child_role AS current_user_role
        FROM children c

        INNER JOIN families f
          ON f.id = c.family_id
          AND f.deleted_at IS NULL

        INNER JOIN children_members cm
          ON cm.child_id = c.id
          AND cm.revoked_at IS NULL

        INNER JOIN family_members fm
          ON fm.id = cm.family_member_id
          AND fm.family_id = c.family_id
          AND fm.user_id = $2
          AND fm.removed_at IS NULL

        WHERE c.id = $1
          AND c.deleted_at IS NULL

        LIMIT 1
      `,
      [childId, userId],
    );

    if (accessResult.rowCount === 0) {
      throw createServiceError(
        "CHILD_NOT_FOUND_OR_FORBIDDEN",
        "The child was not found or you do not have access to this profile.",
        404,
      );
    }

    const access = accessResult.rows[0];
    const canManageMembers = access.current_user_role === "owner";

    /*
     * Récupère tous les membres possédant encore un accès actif.
     */
    const membersResult = await client.query(
      `
        SELECT
          u.id AS user_id,
          cm.id AS child_member_id,

          COALESCE(
            NULLIF(TRIM(u.display_name), ''),
            SPLIT_PART(u.email, '@', 1)
          ) AS first_name,

          cm.child_role,
          cm.relationship_type,
          cm.relationship_label,
          cm.joined_at

        FROM children_members cm

        INNER JOIN family_members fm
          ON fm.id = cm.family_member_id
          AND fm.family_id = $2
          AND fm.removed_at IS NULL

        INNER JOIN users u
          ON u.id = fm.user_id
          AND u.deleted_at IS NULL
          AND u.status = 'active'

        WHERE cm.child_id = $1
          AND cm.revoked_at IS NULL

        ORDER BY
          CASE
            WHEN cm.child_role = 'owner' THEN 0
            ELSE 1
          END,
          cm.joined_at ASC,
          cm.id ASC
      `,
      [childId, access.family_id],
    );

    const members = membersResult.rows.map((row) => ({
      id: row.user_id,
      childMemberId: row.child_member_id,
      firstName: row.first_name,
      role: row.child_role,
      relationshipType: row.relationship_type,
      relationshipLabel: row.relationship_label,
      joinedAt: row.joined_at,
    }));

    /*
     * Seul le propriétaire reçoit les invitations en attente.
     * Le token et son hash ne sont jamais retournés.
     */
    let pendingInvitations = [];

    if (canManageMembers) {
      const invitationsResult = await client.query(
        `
          SELECT
            id,
            email,
            child_role,
            relationship_type,
            relationship_label,
            expires_at,
            created_at

          FROM family_invitations

          WHERE child_id = $1
            AND family_id = $2
            AND accepted_at IS NULL
            AND revoked_at IS NULL
            AND expires_at > NOW()

          ORDER BY
            created_at DESC,
            id DESC
        `,
        [childId, access.family_id],
      );

      pendingInvitations = invitationsResult.rows.map((row) => ({
        id: row.id,
        email: row.email,
        childRole: row.child_role,
        relationshipType: row.relationship_type,
        relationshipLabel: row.relationship_label,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
      }));
    }

    await client.query("COMMIT");

    return {
      currentUserRole: access.current_user_role,
      canManageMembers,
      memberCount: members.length,
      pendingInvitationCount: pendingInvitations.length,
      members,
      pendingInvitations,
    };
  } catch (error) {
    await client.query("ROLLBACK");

    throw error;
  } finally {
    client.release();
  }
}

async function removeChildMember({ childId, childMemberId, userId }) {
  if (!isValidUuid(childId)) {
    throw createServiceError(
      "INVALID_CHILD_ID",
      "The child ID is invalid.",
      400,
    );
  }

  if (!isValidUuid(childMemberId)) {
    throw createServiceError(
      "INVALID_CHILD_MEMBER_ID",
      "The child member ID is invalid.",
      400,
    );
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    /*
     * Vérifie que l'utilisateur connecté est propriétaire de l'enfant.
     */
    const childResult = await client.query(
      `
        SELECT
          c.id,
          c.family_id
        FROM children c

        INNER JOIN families f
          ON f.id = c.family_id
          AND f.deleted_at IS NULL

        INNER JOIN children_members owner_cm
          ON owner_cm.child_id = c.id
          AND owner_cm.child_role = 'owner'
          AND owner_cm.revoked_at IS NULL

        INNER JOIN family_members owner_fm
          ON owner_fm.id = owner_cm.family_member_id
          AND owner_fm.family_id = c.family_id
          AND owner_fm.user_id = $2
          AND owner_fm.removed_at IS NULL

        WHERE c.id = $1
          AND c.deleted_at IS NULL

        LIMIT 1
        FOR UPDATE OF c
      `,
      [childId, userId],
    );

    if (childResult.rowCount === 0) {
      throw createServiceError(
        "CHILD_NOT_FOUND_OR_FORBIDDEN",
        "The child was not found or you cannot remove members from this profile.",
        403,
      );
    }

    const child = childResult.rows[0];

    /*
     * Récupère et verrouille l'accès à supprimer.
     */
    const memberResult = await client.query(
      `
        SELECT
          cm.id AS child_member_id,
          cm.child_id,
          cm.child_role,
          fm.user_id
        FROM children_members cm

        INNER JOIN family_members fm
          ON fm.id = cm.family_member_id
          AND fm.family_id = $3
          AND fm.removed_at IS NULL

        WHERE cm.id = $1
          AND cm.child_id = $2
          AND cm.revoked_at IS NULL

        LIMIT 1
        FOR UPDATE OF cm
      `,
      [childMemberId, childId, child.family_id],
    );

    if (memberResult.rowCount === 0) {
      throw createServiceError(
        "CHILD_MEMBER_NOT_FOUND",
        "The child member was not found.",
        404,
      );
    }

    const member = memberResult.rows[0];

    if (member.user_id === userId) {
      throw createServiceError(
        "CANNOT_REMOVE_YOURSELF",
        "You cannot remove your own access here.",
        409,
      );
    }

    if (member.child_role === "owner") {
      throw createServiceError(
        "CANNOT_REMOVE_OWNER",
        "The profile owner cannot be removed.",
        409,
      );
    }

    const removedMemberResult = await client.query(
      `
        UPDATE children_members
        SET
          revoked_at = NOW(),
          revoked_by_user_id = $2,
          updated_at = NOW()
        WHERE id = $1
        RETURNING
          id,
          child_id,
          revoked_at
      `,
      [member.child_member_id, userId],
    );

    await client.query("COMMIT");

    const removedMember = removedMemberResult.rows[0];

    return {
      childMemberId: removedMember.id,
      userId: member.user_id,
      childId: removedMember.child_id,
      revokedAt: removedMember.revoked_at,
    };
  } catch (error) {
    await client.query("ROLLBACK");

    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  createFamilyInvitation,
  getChildSharing,
  getFamilyInvitationPreview,
  removeChildMember,
  resendFamilyInvitation,
  revokeFamilyInvitation,
};
