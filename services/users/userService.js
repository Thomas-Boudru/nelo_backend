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

module.exports = {
  getCurrentUser,
};
