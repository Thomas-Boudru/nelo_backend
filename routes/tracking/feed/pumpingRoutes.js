const express = require("express");

const {
  getPumpingEntry,
  createPumpingEntry,
  updatePumpingEntry,
} = require("../../../controllers/tracking/feed/pumpingController");

const router = express.Router();

router.get("/:childId/pumping/:entryId", getPumpingEntry);
router.post("/:childId/pumping", createPumpingEntry);
router.put("/:childId/pumping/:entryId", updatePumpingEntry);

module.exports = router;
