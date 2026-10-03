const express = require("express");

const {
  getMoodEntry,
  createMoodEntry,
} = require("../../../controllers/tracking/mood/moodController");

const router = express.Router();

router.post("/:childId/mood", createMoodEntry);
router.get("/:childId/mood/:entryId", getMoodEntry);

module.exports = router;
