const express = require("express");

const {
  createDiaperEntry,
  getDiaperEntry,
  updateDiaperEntry,
  createPottyEntry,
  getPottyEntry,
  updatePottyEntry,
} = require("../../../controllers/tracking/diaper/toiletingController");

const router = express.Router();

router.post("/:childId/diapers", createDiaperEntry);
router.get("/:childId/diapers/:entryId", getDiaperEntry);
router.put("/:childId/diapers/:entryId", updateDiaperEntry);

router.post("/:childId/potty", createPottyEntry);
router.get("/:childId/potty/:entryId", getPottyEntry);
router.put("/:childId/potty/:entryId", updatePottyEntry);

module.exports = router;
