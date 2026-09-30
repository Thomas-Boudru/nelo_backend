const express = require("express");

const {
  getBottlePresets,
  createBottlePreset,
  archiveBottlePreset,
} = require("../../../controllers/tracking/feed/bottlePresetController");

const router = express.Router();

router.get("/:childId/bottle-presets", getBottlePresets);

router.post("/:childId/bottle-presets", createBottlePreset);

router.delete("/:childId/bottle-presets/:presetId", archiveBottlePreset);

module.exports = router;
