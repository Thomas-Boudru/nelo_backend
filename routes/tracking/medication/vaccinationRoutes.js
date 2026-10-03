const express = require("express");

const {
  getVaccinationEntry,
  createVaccinationEntry,
  getVaccinationReminders,
} = require("../../../controllers/tracking/medication/vaccinationController");

const router = express.Router();

router.get("/:childId/vaccination-reminders", getVaccinationReminders);

router.post("/:childId/vaccines", createVaccinationEntry);
router.get("/:childId/vaccines/:entryId", getVaccinationEntry);

module.exports = router;
