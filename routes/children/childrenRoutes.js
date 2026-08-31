const express = require("express");

const authenticate = require("../../middleware/authenticate");

const { uploadChildAvatar } = require("../../middleware/uploadChildAvatar");

const {
  getAccessibleChildren,
  removeChildAvatar,
  saveChildAvatar,
} = require("../../controllers/children/childrenController");

const router = express.Router();

router.get("/", authenticate, getAccessibleChildren);

router.put(
  "/:childId/avatar",
  authenticate,

  uploadChildAvatar,

  saveChildAvatar,
);

router.delete("/:childId/avatar", authenticate, removeChildAvatar);

module.exports = router;
