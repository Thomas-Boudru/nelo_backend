const express = require("express");

const {
  getSolidFeedingEntry,
  createSolidFeedingEntry,
  updateSolidFeedingEntry,
} = require("../../../controllers/tracking/feed/solidFeedingController");

const router = express.Router();

router.get("/:childId/solids/:entryId", getSolidFeedingEntry);

router.post("/:childId/solids", createSolidFeedingEntry);

router.put("/:childId/solids/:entryId", updateSolidFeedingEntry);

module.exports = router;
