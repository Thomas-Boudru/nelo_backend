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

module.exports = {
  createFamilyInvitation,
  resendFamilyInvitation,
  revokeFamilyInvitation,
};
