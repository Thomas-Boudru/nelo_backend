const express = require("express");

const authenticate = require("../../middleware/authenticate");

const { uploadChildAvatar } = require("../../middleware/uploadChildAvatar");

const {
  createChild,
  getAccessibleChildren,
  removeChildAvatar,
  saveChildAvatar,
  updateChild,
  updateChildPreferences,
} = require("../../controllers/children/childrenController");

const router = express.Router();

router.get("/", authenticate, getAccessibleChildren);

router.post("/", authenticate, createChild);

router.patch("/:childId/preferences", authenticate, updateChildPreferences);

router.patch("/:childId", authenticate, updateChild);

router.patch("/:childId/preferences", authenticate, updateChildPreferences);

router.put(
  "/:childId/avatar",
  authenticate,

  uploadChildAvatar,

  saveChildAvatar,
);

router.delete("/:childId/avatar", authenticate, removeChildAvatar);

module.exports = router;
