const express = require("express");

const {
  getBreastfeedingEntry,
  createBreastfeedingEntry,
  updateBreastfeedingEntry,
} = require("../../../controllers/tracking/feed/breastFeedingController");

const router = express.Router();

router.get("/:childId/breastfeeding/:entryId", getBreastfeedingEntry);
router.post("/:childId/breastfeeding", createBreastfeedingEntry);
router.put("/:childId/breastfeeding/:entryId", updateBreastfeedingEntry);

module.exports = router;
