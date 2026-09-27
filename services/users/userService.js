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

    const result = await client.query(
      `
        UPDATE users
        SET deleted_at = NOW(),
            updated_at = NOW()
        WHERE id = $1
          AND deleted_at IS NULL
        RETURNING id
      `,
      [userId],
    );

    if (result.rowCount === 0) {
      const error = new Error("Account not found.");
      error.code = "USER_NOT_FOUND";
      error.status = 404;
      throw error;
    }

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
        UPDATE email_change_requests
        SET consumed_at = NOW()
        WHERE user_id = $1
          AND consumed_at IS NULL
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

module.exports = {
  getCurrentUser,
  updatePreferredName,
  softDeleteCurrentUser,
};
