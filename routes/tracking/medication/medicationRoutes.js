const express = require("express");

const {
  getMedicationEntry,
  createMedicationEntry,
} = require("../../../controllers/tracking/medication/medicationController");

const router = express.Router();

router.post("/:childId/medications", createMedicationEntry);
router.get("/:childId/medications/:entryId", getMedicationEntry);

module.exports = router;
