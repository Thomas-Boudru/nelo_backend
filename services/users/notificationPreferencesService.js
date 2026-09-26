const pool = require("../../db/pool");

const ALLOWED_FIELDS = [
  "notifications_enabled",
  "tracking_reminders_enabled",
  "daily_tip_enabled",
  "invitation_accepted_enabled",
  "important_shared_activity_enabled",
];

const RETURNING_FIELDS = `
  notifications_enabled,
  tracking_reminders_enabled,
  daily_tip_enabled,
  invitation_accepted_enabled,
  important_shared_activity_enabled
`;

async function getNotificationPreferencesForUser(userId) {
  await pool.query(
    `
      INSERT INTO user_notification_preferences (user_id)
      VALUES ($1)
      ON CONFLICT (user_id) DO NOTHING
    `,
    [userId],
  );

  const { rows } = await pool.query(
    `
      SELECT ${RETURNING_FIELDS}
      FROM user_notification_preferences
      WHERE user_id = $1
    `,
    [userId],
  );

  return rows[0];
}

async function updateNotificationPreferencesForUser(userId, changes) {
  const fields = Object.keys(changes);

  // Les noms des colonnes viennent uniquement de la liste autorisée
  // vérifiée dans le controller.
  const assignments = fields
    .map((field, index) => `${field} = $${index + 2}`)
    .join(", ");

  const values = fields.map((field) => changes[field]);

  await pool.query(
    `
      INSERT INTO user_notification_preferences (user_id)
      VALUES ($1)
      ON CONFLICT (user_id) DO NOTHING
    `,
    [userId],
  );

  const { rows } = await pool.query(
    `
      UPDATE user_notification_preferences
      SET ${assignments}, updated_at = now()
      WHERE user_id = $1
      RETURNING ${RETURNING_FIELDS}
    `,
    [userId, ...values],
  );

  return rows[0];
}

module.exports = {
  ALLOWED_FIELDS,
  getNotificationPreferencesForUser,
  updateNotificationPreferencesForUser,
};
