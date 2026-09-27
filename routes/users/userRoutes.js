const express = require("express");

const authenticate = require("../../middleware/authenticate");

const {
  getCurrentUser,
  updatePreferredName,
} = require("../../controllers/users/userController");

const {
  getUserPreferences,
  updateUserPreferences,
} = require("../../controllers/users/userPreferencesController");

const {
  getNotificationPreferences,
  updateNotificationPreferences,
} = require("../../controllers/users/notificationPreferencesController");

const router = express.Router();

router.get("/me", authenticate, getCurrentUser);

router.get("/me/preferences", authenticate, getUserPreferences);

router.patch("/me/preferences", authenticate, updateUserPreferences);

router.patch("/me", authenticate, updatePreferredName);

router.get(
  "/me/notification-preferences",
  authenticate,
  getNotificationPreferences,
);

router.patch(
  "/me/notification-preferences",
  authenticate,
  updateNotificationPreferences,
);

module.exports = router;
