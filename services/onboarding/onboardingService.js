const pool = require("../../db/pool");

function createServiceError(code, message, status) {
  const error = new Error(message);

  error.code = code;
  error.status = status;

  return error;
}

function mapExistingOnboarding(row) {
  return {
    alreadyCompleted: true,
    completedAt: row.onboarding_completed_at,

    user: {
      id: row.user_id,
      displayName: row.user_display_name,
    },

    family: row.family_id
      ? {
          id: row.family_id,
          role: row.family_role,
        }
      : null,

    child: row.child_id
      ? {
          id: row.child_id,
          displayName: row.child_display_name,
          status: row.birth_status,
          role: row.child_role,
          relationship: row.relationship_type,
          themeMode: row.theme_mode,
        }
      : null,
  };
}

async function findExistingOnboarding(client, userId) {
  const result = await client.query(
    `
      SELECT
        u.id AS user_id,
        u.display_name AS user_display_name,
        u.onboarding_completed_at,

        f.id AS family_id,
        fm.family_role,

        c.id AS child_id,
        c.display_name AS child_display_name,
        c.birth_status,

        cm.child_role,
        cm.relationship_type,

        cmp.theme_mode

      FROM users u

      LEFT JOIN family_members fm
        ON fm.user_id = u.id
        AND fm.removed_at IS NULL

      LEFT JOIN families f
        ON f.id = fm.family_id
        AND f.deleted_at IS NULL

      LEFT JOIN children_members cm
        ON cm.family_member_id = fm.id
        AND cm.revoked_at IS NULL

      LEFT JOIN children c
        ON c.id = cm.child_id
        AND c.deleted_at IS NULL

      LEFT JOIN children_member_preferences cmp
        ON cmp.child_member_id = cm.id

      WHERE u.id = $1
        AND u.deleted_at IS NULL

      ORDER BY
        f.created_at ASC NULLS LAST,
        c.created_at ASC NULLS LAST

      LIMIT 1
    `,
    [userId],
  );

  return result.rows[0] || null;
}

async function completeOnboarding({ userId, data }) {
  const client = await pool.connect();
  let transactionOpen = false;

  try {
    await client.query("BEGIN");
    transactionOpen = true;

    /*
     * Le verrou empêche deux requêtes d’onboarding simultanées
     * de créer deux familles pour le même utilisateur.
     */
    const userResult = await client.query(
      `
        SELECT
          id,
          onboarding_completed_at

        FROM users

        WHERE id = $1
          AND deleted_at IS NULL
          AND status = 'active'

        FOR UPDATE
      `,
      [userId],
    );

    if (userResult.rowCount === 0) {
      throw createServiceError(
        "USER_NOT_FOUND",
        "The user could not be found.",
        404,
      );
    }

    /*
     * Si l’application répète la requête après une perte de
     * connexion, on retourne les données déjà créées.
     */
    if (userResult.rows[0].onboarding_completed_at) {
      const existingOnboarding = await findExistingOnboarding(client, userId);

      if (!existingOnboarding) {
        throw createServiceError(
          "ONBOARDING_STATE_INCONSISTENT",
          "The onboarding is marked as complete but its data could not be found.",
          409,
        );
      }

      await client.query("COMMIT");
      transactionOpen = false;

      return mapExistingOnboarding(existingOnboarding);
    }

    /*
     * 1. Enregistrer le nom choisi par l’utilisateur.
     */
    const updatedUserResult = await client.query(
      `
        UPDATE users

        SET
          display_name = $2,
          updated_at = NOW()

        WHERE id = $1

        RETURNING
          id,
          display_name
      `,
      [userId, data.user.displayName],
    );

    const updatedUser = updatedUserResult.rows[0];

    /*
     * Parcours "join" :
     * l’utilisateur attend ou utilisera une invitation.
     * On ne crée ni famille, ni enfant, ni children_member.
     */
    if (data.child === null) {
      const completedUserResult = await client.query(
        `
      UPDATE users

      SET
        onboarding_completed_at = NOW(),
        updated_at = NOW()

      WHERE id = $1

      RETURNING onboarding_completed_at
    `,
        [userId],
      );

      await client.query("COMMIT");
      transactionOpen = false;

      return {
        alreadyCompleted: false,
        completedAt: completedUserResult.rows[0].onboarding_completed_at,

        user: {
          id: updatedUser.id,
          displayName: updatedUser.display_name,
        },

        family: null,
        child: null,
      };
    }

    /*
     * 2. Créer la famille.
     */
    const familyResult = await client.query(
      `
        INSERT INTO families (
          created_by_user_id
        )
        VALUES ($1)

        RETURNING id
      `,
      [userId],
    );

    const familyId = familyResult.rows[0].id;

    /*
     * 3. Ajouter l’utilisateur comme owner de la famille.
     */
    const familyMemberResult = await client.query(
      `
        INSERT INTO family_members (
          family_id,
          user_id,
          family_role,
          created_by_user_id
        )
        VALUES ($1, $2, 'owner', $2)

        RETURNING
          id,
          family_role
      `,
      [familyId, userId],
    );

    const familyMember = familyMemberResult.rows[0];

    /*
     * 4. Créer l’enfant.
     *
     * isPremature n’est pas enregistré directement :
     * la présence de gestational_age_weeks permet de le déduire.
     */
    const childResult = await client.query(
      `
        INSERT INTO children (
          family_id,
          display_name,
          birth_status,
          birth_date,
          birth_time,
          expected_due_date,
          sex_at_birth,
          gestational_age_weeks,
          gestational_age_days,
          created_by_user_id
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10
        )

        RETURNING
          id,
          display_name,
          birth_status
      `,
      [
        familyId,
        data.child.displayName || null,
        data.child.status,
        data.child.birthDate,
        data.child.birthTime,
        data.child.expectedBirthDate,
        data.child.gender,
        data.child.isPremature ? data.child.gestationalAgeWeeks : null,
        data.child.isPremature ? data.child.gestationalAgeDays : null,
        userId,
      ],
    );

    const child = childResult.rows[0];

    /*
     * 5. Associer le membre à l’enfant.
     */
    const childMemberResult = await client.query(
      `
        INSERT INTO children_members (
          child_id,
          family_member_id,
          child_role,
          relationship_type,
          created_by_user_id
        )
        VALUES ($1, $2, 'owner', $3, $4)

        RETURNING
          id,
          child_role,
          relationship_type
      `,
      [child.id, familyMember.id, data.membership.relationship, userId],
    );

    const childMember = childMemberResult.rows[0];

    /*
     * 6. Enregistrer la préférence personnelle du membre
     * pour cet enfant.
     */
    const preferencesResult = await client.query(
      `
        INSERT INTO children_member_preferences (
          child_member_id,
          theme_mode
        )
        VALUES ($1, $2)

        RETURNING theme_mode
      `,
      [childMember.id, data.preferences.themeMode],
    );

    const preferences = preferencesResult.rows[0];

    /*
     * 7. Marquer l’onboarding comme terminé.
     *
     * Cette opération reste la dernière de la transaction.
     */
    const completedUserResult = await client.query(
      `
        UPDATE users

        SET
          onboarding_completed_at = NOW(),
          updated_at = NOW()

        WHERE id = $1

        RETURNING onboarding_completed_at
      `,
      [userId],
    );

    await client.query("COMMIT");
    transactionOpen = false;

    return {
      alreadyCompleted: false,
      completedAt: completedUserResult.rows[0].onboarding_completed_at,

      user: {
        id: updatedUser.id,
        displayName: updatedUser.display_name,
      },

      family: {
        id: familyId,
        role: familyMember.family_role,
      },

      child: {
        id: child.id,
        displayName: child.display_name,
        status: child.birth_status,
        role: childMember.child_role,
        relationship: childMember.relationship_type,
        themeMode: preferences.theme_mode,
      },
    };
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error(
          "Unable to rollback onboarding transaction:",
          rollbackError,
        );
      }
    }

    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  completeOnboarding,
};
