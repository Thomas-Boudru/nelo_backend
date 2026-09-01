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

  const gestationalAgeWeeks =
    row.gestational_age_weeks === null
      ? null
      : Number(row.gestational_age_weeks);

  return {
    id: row.id,
    status: row.birth_status,

    firstName: row.birth_status === "born" ? row.display_name : null,

    displayName: row.display_name,
    gender: row.sex_at_birth,
    birthDate: row.birth_date,
    expectedDueDate: row.expected_due_date,

    isPremature:
      row.birth_status === "born"
        ? gestationalAgeWeeks !== null && gestationalAgeWeeks < 37
        : null,

    gestationalAgeWeeks,

    gestationalAgeDays:
      row.gestational_age_days === null
        ? null
        : Number(row.gestational_age_days),

    avatar,
    themeMode: row.theme_mode,
    familyId: row.family_id,
    role: row.child_role,
    updatedAt: row.updated_at,
  };
}

function createServiceError(code, message, status, details) {
  const error = new Error(message);

  error.code = code;
  error.status = status;
  error.details = details;

  return error;
}

function validateChildData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw createServiceError(
      "INVALID_CHILD_DATA",
      "The child data is required.",
      400,
    );
  }

  const status = data.status;

  if (!["born", "expected"].includes(status)) {
    throw createServiceError(
      "INVALID_CHILD_STATUS",
      "The child status must be born or expected.",
      400,
    );
  }

  const displayName =
    typeof data.displayName === "string" ? data.displayName.trim() : "";

  if (displayName.length > 100) {
    throw createServiceError(
      "CHILD_NAME_TOO_LONG",
      "The child name cannot contain more than 100 characters.",
      400,
    );
  }

  if (status === "born" && !displayName) {
    throw createServiceError(
      "MISSING_CHILD_NAME",
      "The child's first name is required.",
      400,
    );
  }

  if (status === "born" && !data.birthDate) {
    throw createServiceError(
      "MISSING_BIRTH_DATE",
      "The child's date of birth is required.",
      400,
    );
  }

  if (status === "expected" && !data.expectedDueDate) {
    throw createServiceError(
      "MISSING_EXPECTED_DUE_DATE",
      "The expected due date is required.",
      400,
    );
  }

  const gender = data.gender ?? null;

  if (
    gender !== null &&
    !["female", "male", "intersex", "unspecified"].includes(gender)
  ) {
    throw createServiceError(
      "INVALID_CHILD_GENDER",
      "The selected gender is invalid.",
      400,
    );
  }

  let gestationalAgeWeeks = null;

  if (status === "born" && data.isPremature === true) {
    gestationalAgeWeeks = Number(data.gestationalAgeWeeks);

    if (
      !Number.isInteger(gestationalAgeWeeks) ||
      gestationalAgeWeeks < 20 ||
      gestationalAgeWeeks > 36
    ) {
      throw createServiceError(
        "INVALID_GESTATIONAL_AGE",
        "The gestational age must be between 20 and 36 weeks.",
        400,
      );
    }
  }

  return {
    status,
    displayName: displayName || null,
    gender,

    birthDate: status === "born" ? data.birthDate : null,

    expectedDueDate: status === "expected" ? data.expectedDueDate : null,

    gestationalAgeWeeks,
    gestationalAgeDays: null,
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
        c.gestational_age_weeks,
        c.gestational_age_days,
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

async function createChild({ userId, data }) {
  const childData = validateChildData(data);

  const client = await pool.connect();
  let transactionOpen = false;

  try {
    await client.query("BEGIN");
    transactionOpen = true;

    /*
     * Sérialise deux créations simultanées effectuées
     * par le même utilisateur.
     */
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
      throw createServiceError(
        "USER_NOT_FOUND",
        "The user could not be found.",
        404,
      );
    }

    /*
     * On cherche uniquement une famille dans laquelle
     * l’utilisateur est owner.
     */
    const ownedFamilyResult = await client.query(
      `
        SELECT
          f.id AS family_id,
          fm.id AS family_member_id

        FROM family_members fm

        INNER JOIN families f
          ON f.id = fm.family_id
          AND f.deleted_at IS NULL

        WHERE fm.user_id = $1
          AND fm.family_role = 'owner'
          AND fm.removed_at IS NULL

        LIMIT 1
      `,
      [userId],
    );

    let familyId;
    let familyMemberId;

    if (ownedFamilyResult.rowCount > 0) {
      familyId = ownedFamilyResult.rows[0].family_id;
      familyMemberId = ownedFamilyResult.rows[0].family_member_id;
    } else {
      /*
       * L’utilisateur peut être contributor dans d’autres
       * familles. On crée ici sa propre famille.
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

      familyId = familyResult.rows[0].id;

      const familyMemberResult = await client.query(
        `
          INSERT INTO family_members (
            family_id,
            user_id,
            family_role,
            created_by_user_id
          )
          VALUES ($1, $2, 'owner', $2)

          RETURNING id
        `,
        [familyId, userId],
      );

      familyMemberId = familyMemberResult.rows[0].id;
    }

    const childResult = await client.query(
      `
        INSERT INTO children (
          family_id,
          display_name,
          birth_status,
          birth_date,
          expected_due_date,
          sex_at_birth,
          gestational_age_weeks,
          gestational_age_days,
          default_theme_mode,
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
          'blue',
          $9
        )

        RETURNING id
      `,
      [
        familyId,
        childData.displayName,
        childData.status,
        childData.birthDate,
        childData.expectedDueDate,
        childData.gender,
        childData.gestationalAgeWeeks,
        childData.gestationalAgeDays,
        userId,
      ],
    );

    const childId = childResult.rows[0].id;

    const childMemberResult = await client.query(
      `
        INSERT INTO children_members (
          child_id,
          family_member_id,
          child_role,
          relationship_type,
          created_by_user_id
        )
        VALUES ($1, $2, 'owner', 'parent', $3)

        RETURNING id
      `,
      [childId, familyMemberId, userId],
    );

    const childMemberId = childMemberResult.rows[0].id;

    await client.query(
      `
        INSERT INTO children_member_preferences (
          child_member_id,
          theme_mode
        )
        VALUES ($1, 'blue')
      `,
      [childMemberId],
    );

    const savedChildResult = await client.query(
      `
        SELECT
          c.id,
          c.display_name,
          c.birth_status,
          c.birth_date,
          c.expected_due_date,
          c.sex_at_birth,
          c.gestational_age_weeks,
          c.gestational_age_days,
          c.family_id,
          c.updated_at,

          cm.child_role,

          COALESCE(
            cmp.theme_mode,
            c.default_theme_mode
          ) AS theme_mode,

          avatar.id AS avatar_attachment_id,
          avatar.storage_key AS avatar_storage_key

        FROM children c

        INNER JOIN children_members cm
          ON cm.child_id = c.id
          AND cm.family_member_id = $2
          AND cm.revoked_at IS NULL

        LEFT JOIN children_member_preferences cmp
          ON cmp.child_member_id = cm.id

        LEFT JOIN attachments avatar
          ON avatar.id = c.avatar_attachment_id
          AND avatar.deleted_at IS NULL

        WHERE c.id = $1
          AND c.deleted_at IS NULL
      `,
      [childId, familyMemberId],
    );

    if (savedChildResult.rowCount === 0) {
      throw createServiceError(
        "CHILD_CREATION_INCONSISTENT",
        "The child was created but could not be retrieved.",
        500,
      );
    }

    await client.query("COMMIT");
    transactionOpen = false;

    return mapChild(savedChildResult.rows[0]);
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Unable to rollback child creation:", rollbackError);
      }
    }

    throw error;
  } finally {
    client.release();
  }
}

async function updateChild({ childId, userId, data }) {
  if (!childId) {
    throw createServiceError(
      "MISSING_CHILD_ID",
      "The child ID is required.",
      400,
    );
  }

  const childData = validateChildData(data);

  const client = await pool.connect();
  let transactionOpen = false;

  try {
    await client.query("BEGIN");
    transactionOpen = true;

    /*
     * Vérifier l’accès et verrouiller l’enfant pendant
     * toute la modification.
     */
    const accessResult = await client.query(
      `
        SELECT
          c.id,
          c.birth_status,
          cm.child_role

        FROM children c

        INNER JOIN children_members cm
          ON cm.child_id = c.id
          AND cm.revoked_at IS NULL

        INNER JOIN family_members fm
          ON fm.id = cm.family_member_id
          AND fm.removed_at IS NULL

        INNER JOIN families f
          ON f.id = c.family_id
          AND f.id = fm.family_id
          AND f.deleted_at IS NULL

        WHERE c.id = $1
          AND c.deleted_at IS NULL
          AND fm.user_id = $2

        FOR UPDATE OF c
      `,
      [childId, userId],
    );

    /*
     * Retourner 404 si l’utilisateur n’a pas accès à l’enfant.
     * Cela évite de révéler l’existence d’un enfant inaccessible.
     */
    if (accessResult.rowCount === 0) {
      throw createServiceError(
        "CHILD_NOT_FOUND",
        "The child could not be found.",
        404,
      );
    }

    const existingChild = accessResult.rows[0];

    if (existingChild.child_role !== "owner") {
      throw createServiceError(
        "CHILD_OWNER_REQUIRED",
        "Only an owner can edit this child's profile.",
        403,
      );
    }

    /*
     * Une naissance peut être déclarée, mais un enfant né
     * ne peut pas redevenir un enfant attendu.
     */
    if (
      existingChild.birth_status === "born" &&
      childData.status === "expected"
    ) {
      throw createServiceError(
        "BIRTH_STATUS_CANNOT_BE_REVERSED",
        "A born child cannot be changed back to expected.",
        409,
      );
    }

    await client.query(
      `
        UPDATE children

        SET
          display_name = $3,
          birth_status = $4,
          birth_date = $5,
          expected_due_date = $6,
          sex_at_birth = $7,
          gestational_age_weeks = $8,
          gestational_age_days = $9,
          updated_by_user_id = $2,
          updated_at = NOW()

        WHERE id = $1
      `,
      [
        childId,
        userId,
        childData.displayName,
        childData.status,
        childData.birthDate,
        childData.expectedDueDate,
        childData.gender,
        childData.gestationalAgeWeeks,
        childData.gestationalAgeDays,
      ],
    );

    const savedChildResult = await client.query(
      `
        SELECT
          c.id,
          c.display_name,
          c.birth_status,
          c.birth_date,
          c.expected_due_date,
          c.sex_at_birth,
          c.gestational_age_weeks,
          c.gestational_age_days,
          c.family_id,
          c.updated_at,

          cm.child_role,

          COALESCE(
            cmp.theme_mode,
            c.default_theme_mode
          ) AS theme_mode,

          avatar.id AS avatar_attachment_id,
          avatar.storage_key AS avatar_storage_key

        FROM children c

        INNER JOIN children_members cm
          ON cm.child_id = c.id
          AND cm.revoked_at IS NULL

        INNER JOIN family_members fm
          ON fm.id = cm.family_member_id
          AND fm.user_id = $2
          AND fm.removed_at IS NULL

        LEFT JOIN children_member_preferences cmp
          ON cmp.child_member_id = cm.id

        LEFT JOIN attachments avatar
          ON avatar.id = c.avatar_attachment_id
          AND avatar.deleted_at IS NULL

        WHERE c.id = $1
          AND c.deleted_at IS NULL
      `,
      [childId, userId],
    );

    if (savedChildResult.rowCount === 0) {
      throw createServiceError(
        "CHILD_UPDATE_INCONSISTENT",
        "The child was updated but could not be retrieved.",
        500,
      );
    }

    await client.query("COMMIT");
    transactionOpen = false;

    return mapChild(savedChildResult.rows[0]);
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error(
          "Unable to rollback child profile update:",
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
  createChild,
  getAccessibleChildren,
  updateChild,
};
