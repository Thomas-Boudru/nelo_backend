const express = require("express");

const {
  getTrackingEntries,
  deleteTrackingEntry,
} = require("../../controllers/tracking/trackingController");

const router = express.Router();

router.get("/:childId/tracking", getTrackingEntries);

router.delete("/:childId/tracking/:entryId", deleteTrackingEntry);

module.exports = router;
