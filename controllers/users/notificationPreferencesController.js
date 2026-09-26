const {
  ALLOWED_FIELDS,
  getNotificationPreferencesForUser,
  updateNotificationPreferencesForUser,
} = require("../../services/users/notificationPreferencesService");

function sendError(res, error) {
  console.error("Notification preferences error:", error);

  return res.status(500).json({
    error: "Unable to save notification preferences",
  });
}

async function getNotificationPreferences(req, res) {
  try {
    const preferences = await getNotificationPreferencesForUser(req.user.id);

    return res.json({ preferences });
  } catch (error) {
    return sendError(res, error);
  }
}

async function updateNotificationPreferences(req, res) {
  const changes = req.body;

  if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
    return res.status(400).json({
      error: "Invalid notification preferences",
    });
  }

  const fields = Object.keys(changes);

  if (
    fields.length === 0 ||
    fields.some(
      (field) =>
        !ALLOWED_FIELDS.includes(field) || typeof changes[field] !== "boolean",
    )
  ) {
    return res.status(400).json({
      error: "Invalid notification preferences",
    });
  }

  try {
    const preferences = await updateNotificationPreferencesForUser(
      req.user.id,
      changes,
    );

    return res.json({ preferences });
  } catch (error) {
    return sendError(res, error);
  }
}

module.exports = {
  getNotificationPreferences,
  updateNotificationPreferences,
};
