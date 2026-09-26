const express = require("express");

const authenticate = require("../../middleware/authenticate");

const { getCurrentUser } = require("../../controllers/users/userController");
const {
  getNotificationPreferences,
  updateNotificationPreferences,
} = require("../../controllers/users/notificationPreferencesController");

const router = express.Router();

router.get("/me", authenticate, getCurrentUser);

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
