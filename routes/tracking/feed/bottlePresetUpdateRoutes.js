const express = require("express");

const {
  updateBottlePresetController,
} = require("../../../controllers/tracking/feed/bottlePresetUpdateController");

const router = express.Router();

router.put("/:childId/bottle-presets/:presetId", updateBottlePresetController);

module.exports = router;
