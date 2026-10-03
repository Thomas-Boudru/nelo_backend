const express = require("express");

const {
  createDiaperEntry,
  getDiaperEntry,
  createPottyEntry,
  getPottyEntry,
} = require("../../../controllers/tracking/diaper/toiletingController");

const router = express.Router();

router.post("/:childId/diapers", createDiaperEntry);
router.get("/:childId/diapers/:entryId", getDiaperEntry);

router.post("/:childId/potty", createPottyEntry);
router.get("/:childId/potty/:entryId", getPottyEntry);

module.exports = router;
