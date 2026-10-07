const express = require("express");

const {
  getVaccinationEntry,
  createVaccinationEntry,
  updateVaccinationEntry,
  getVaccinationReminders,
} = require("../../../controllers/tracking/medication/vaccinationController");

const router = express.Router();

router.get("/:childId/vaccination-reminders", getVaccinationReminders);

router.post("/:childId/vaccines", createVaccinationEntry);
router.get("/:childId/vaccines/:entryId", getVaccinationEntry);
router.put("/:childId/vaccines/:entryId", updateVaccinationEntry);

module.exports = router;
