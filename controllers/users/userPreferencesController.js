const userPreferencesService = require("../../services/users/userPreferencesService");

async function getUserPreferences(req, res, next) {
  try {
    const preferences = await userPreferencesService.getUserPreferences(
      req.auth.userId,
    );

    return res.status(200).json({ preferences });
  } catch (error) {
    return next(error);
  }
}

async function updateUserPreferences(req, res, next) {
  try {
    const preferences = await userPreferencesService.updateUserPreferences(
      req.auth.userId,
      req.body,
    );

    return res.status(200).json({ preferences });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getUserPreferences,
  updateUserPreferences,
};
