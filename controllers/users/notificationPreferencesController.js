const {
  ALLOWED_FIELDS,
  getNotificationPreferencesForUser,
  updateNotificationPreferencesForUser,
} = require("../../services/users/notificationPreferencesService");

async function getNotificationPreferences(req, res, next) {
  try {
    const preferences = await getNotificationPreferencesForUser(
      req.auth.userId,
    );

    return res.status(200).json({ preferences });
  } catch (error) {
    return next(error);
  }
}

async function updateNotificationPreferences(req, res, next) {
  const changes = req.body;

  if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
    return res.status(400).json({
      error: {
        code: "INVALID_NOTIFICATION_PREFERENCES",
        message: "Invalid notification preferences.",
      },
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
      error: {
        code: "INVALID_NOTIFICATION_PREFERENCES",
        message: "Invalid notification preferences.",
      },
    });
  }

  try {
    const preferences = await updateNotificationPreferencesForUser(
      req.auth.userId,
      changes,
    );

    return res.status(200).json({ preferences });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getNotificationPreferences,
  updateNotificationPreferences,
};
