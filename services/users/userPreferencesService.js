const pool = require("../../db/pool");

const SUPPORTED_LANGUAGES = new Set(["en", "fr", "de", "es", "it", "nl", "pt"]);

function createServiceError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function mapPreferences(row) {
  return {
    languageCode: row.language_code,
    weightUnit: row.weight_unit,
    lengthUnit: row.length_unit,
    temperatureUnit: row.temperature_unit,
    analyticsEnabled: row.analytics_enabled,
    crashReportsEnabled: row.crash_reports_enabled,
    aiImprovementEnabled: row.ai_improvement_enabled,
  };
}

async function getUserPreferences(userId) {
  const result = await pool.query(
    `
      INSERT INTO user_preferences (user_id)
      VALUES ($1)
      ON CONFLICT (user_id)
      DO UPDATE SET user_id = EXCLUDED.user_id
      RETURNING
        language_code,
        weight_unit,
        length_unit,
        temperature_unit,
        analytics_enabled,
        crash_reports_enabled,
        ai_improvement_enabled
    `,
    [userId],
  );

  return mapPreferences(result.rows[0]);
}

async function updateUserPreferences(userId, changes) {
  if (
    !changes ||
    typeof changes !== "object" ||
    Array.isArray(changes) ||
    !Object.prototype.hasOwnProperty.call(changes, "languageCode") ||
    Object.keys(changes).some((key) => key !== "languageCode")
  ) {
    throw createServiceError(
      "INVALID_USER_PREFERENCES",
      "Only languageCode can be updated.",
      400,
    );
  }

  const { languageCode } = changes;

  if (languageCode !== null && !SUPPORTED_LANGUAGES.has(languageCode)) {
    throw createServiceError(
      "INVALID_LANGUAGE_CODE",
      "Choose a supported language or null for the device language.",
      400,
    );
  }

  const result = await pool.query(
    `
      INSERT INTO user_preferences (user_id, language_code)
      VALUES ($1, $2)
      ON CONFLICT (user_id)
      DO UPDATE SET
        language_code = EXCLUDED.language_code,
        updated_at = NOW()
      RETURNING
        language_code,
        weight_unit,
        length_unit,
        temperature_unit,
        analytics_enabled,
        crash_reports_enabled,
        ai_improvement_enabled
    `,
    [userId, languageCode],
  );

  return mapPreferences(result.rows[0]);
}

module.exports = {
  getUserPreferences,
  updateUserPreferences,
};
