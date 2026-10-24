const express = require("express");

const authenticate = require("../../middleware/authenticate");

const { uploadChildAvatar } = require("../../middleware/uploadChildAvatar");

const sleepPredictionRoutes = require("../sleepPrediction/sleepPredictionRoutes");

const {
  createChild,
  getAccessibleChildren,
  removeChildAvatar,
  saveChildAvatar,
  updateChild,
  updateChildPreferences,
  updateCurrentUserRelationship,
  deleteChild,
  initializeChildSleepTimezone,
} = require("../../controllers/children/childrenController");

const router = express.Router();

router.get("/", authenticate, getAccessibleChildren);

router.post("/", authenticate, createChild);

router.patch("/:childId/preferences", authenticate, updateChildPreferences);

router.put(
  "/:childId/sleep-timezone",
  authenticate,
  initializeChildSleepTimezone,
);

router.patch("/:childId", authenticate, updateChild);

router.put(
  "/:childId/avatar",
  authenticate,

  uploadChildAvatar,

  saveChildAvatar,
);

router.patch(
  "/:childId/members/me",
  authenticate,
  updateCurrentUserRelationship,
);

router.use("/:childId/sleep-prediction", sleepPredictionRoutes);

router.delete("/:childId/avatar", authenticate, removeChildAvatar);
router.delete("/:childId", authenticate, deleteChild);

module.exports = router;
