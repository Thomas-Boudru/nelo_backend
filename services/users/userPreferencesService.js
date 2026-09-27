const pool = require("../../db/pool");

const SUPPORTED_LANGUAGES = new Set(["en", "fr", "de", "es", "it", "nl", "pt"]);

const PREFERENCE_FIELDS = {
  languageCode: {
    column: "language_code",
    isValid: (value) => value === null || SUPPORTED_LANGUAGES.has(value),
  },
  weightUnit: {
    column: "weight_unit",
    isValid: (value) => value === "kg" || value === "lb",
  },
  lengthUnit: {
    column: "length_unit",
    isValid: (value) => value === "cm" || value === "in",
  },
  temperatureUnit: {
    column: "temperature_unit",
    isValid: (value) => value === "c" || value === "f",
  },

  volumeUnit: {
    column: "volume_unit",
    isValid: (value) => value === "ml" || value === "fl_oz",
  },

  analyticsEnabled: {
    column: "analytics_enabled",
    isValid: (value) => typeof value === "boolean",
  },
  crashReportsEnabled: {
    column: "crash_reports_enabled",
    isValid: (value) => typeof value === "boolean",
  },
  aiImprovementEnabled: {
    column: "ai_improvement_enabled",
    isValid: (value) => typeof value === "boolean",
  },
};

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
    volumeUnit: row.volume_unit,
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
        volume_unit,
        analytics_enabled,
        crash_reports_enabled,
        ai_improvement_enabled
    `,
    [userId],
  );

  return mapPreferences(result.rows[0]);
}

async function updateUserPreferences(userId, changes) {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
    throw createServiceError(
      "INVALID_USER_PREFERENCES",
      "Invalid user preferences.",
      400,
    );
  }

  const entries = Object.entries(changes);

  if (
    entries.length === 0 ||
    entries.some(
      ([field, value]) =>
        !PREFERENCE_FIELDS[field] || !PREFERENCE_FIELDS[field].isValid(value),
    )
  ) {
    throw createServiceError(
      "INVALID_USER_PREFERENCES",
      "One or more user preferences are invalid.",
      400,
    );
  }

  // Crée les préférences par défaut si ce compte n'a pas encore de ligne.
  await pool.query(
    `
      INSERT INTO user_preferences (user_id)
      VALUES ($1)
      ON CONFLICT (user_id) DO NOTHING
    `,
    [userId],
  );

  // Seuls les noms de colonnes définis dans PREFERENCE_FIELDS
  // peuvent être insérés dans la requête SQL.
  const assignments = entries.map(
    ([field], index) => `${PREFERENCE_FIELDS[field].column} = $${index + 2}`,
  );

  const values = [userId, ...entries.map(([, value]) => value)];

  const result = await pool.query(
    `
      UPDATE user_preferences
      SET ${assignments.join(", ")},
          updated_at = NOW()
      WHERE user_id = $1
      RETURNING
        language_code,
        weight_unit,
        length_unit,
        temperature_unit,
        volume_unit,
        analytics_enabled,
        crash_reports_enabled,
        ai_improvement_enabled
    `,
    values,
  );

  return mapPreferences(result.rows[0]);
}

module.exports = {
  getUserPreferences,
  updateUserPreferences,
};
