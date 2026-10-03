const express = require("express");

const symptomsController = require("../../../controllers/tracking/symptoms/symptomsController");

const router = express.Router();

router.get("/:childId/symptoms/:entryId", symptomsController.getSymptomsEntry);

router.post("/:childId/symptoms", symptomsController.createSymptomsEntry);

router.patch(
  "/:childId/symptoms/:entryId",
  symptomsController.updateSymptomsEntry,
);

module.exports = router;
