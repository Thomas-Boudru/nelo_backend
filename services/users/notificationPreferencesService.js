const pool = require("../../db/pool");

const ALLOWED_FIELDS = [
  "notifications_enabled",
  "tracking_reminders_enabled",
  "daily_tip_enabled",
  "invitation_accepted_enabled",
  "important_shared_activity_enabled",
];

async function getNotificationPreferencesForUser(userId) {
  const { rows } = await pool.query(
    `
      INSERT INTO user_notification_preferences (user_id)
      VALUES ($1)
      ON CONFLICT (user_id) DO UPDATE
        SET user_id = EXCLUDED.user_id
      RETURNING
        notifications_enabled,
        tracking_reminders_enabled,
        daily_tip_enabled,
        invitation_accepted_enabled,
        important_shared_activity_enabled
    `,
    [userId],
  );

  return rows[0];
}

async function updateNotificationPreferencesForUser(userId, changes) {
  const fields = Object.keys(changes);
  const values = fields.map((field) => changes[field]);

  const assignments = fields
    .map((field, index) => `${field} = $${index + 2}`)
    .join(", ");

  const { rows } = await pool.query(
    `
      INSERT INTO user_notification_preferences (user_id)
      VALUES ($1)
      ON CONFLICT (user_id) DO NOTHING
    `,
    [userId],
  );

  // L'INSERT garantit qu'une ligne existe aussi pour un nouveau compte.
  const result = await pool.query(
    `
      UPDATE user_notification_preferences
      SET ${assignments}, updated_at = now()
      WHERE user_id = $1
      RETURNING
        notifications_enabled,
        tracking_reminders_enabled,
        daily_tip_enabled,
        invitation_accepted_enabled,
        important_shared_activity_enabled
    `,
    [userId, ...values],
  );

  return result.rows[0];
}

module.exports = {
  ALLOWED_FIELDS,
  getNotificationPreferencesForUser,
  updateNotificationPreferencesForUser,
};
