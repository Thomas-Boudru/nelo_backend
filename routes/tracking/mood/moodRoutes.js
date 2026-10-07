const express = require("express");

const {
  getMoodEntry,
  createMoodEntry,
  updateMoodEntry,
} = require("../../../controllers/tracking/mood/moodController");

const router = express.Router();

router.post("/:childId/mood", createMoodEntry);
router.get("/:childId/mood/:entryId", getMoodEntry);
router.put("/:childId/mood/:entryId", updateMoodEntry);

module.exports = router;
