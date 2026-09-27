const express = require("express");

const authenticate = require("../../middleware/authenticate");

const {
  requestEmailChange,
  verifyEmailChange,
} = require("../../controllers/users/emailChangeController");

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

router.post("/me/email-change/request", authenticate, requestEmailChange);
router.post("/me/email-change/verify", authenticate, verifyEmailChange);

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
