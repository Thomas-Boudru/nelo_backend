const express = require("express");

const {
  getMedicationEntry,
  createMedicationEntry,
  updateMedicationEntry,
} = require("../../../controllers/tracking/medication/medicationController");

const router = express.Router();

router.post("/:childId/medications", createMedicationEntry);
router.get("/:childId/medications/:entryId", getMedicationEntry);
router.put("/:childId/medications/:entryId", updateMedicationEntry);

module.exports = router;
