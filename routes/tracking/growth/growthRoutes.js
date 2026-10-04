const express = require("express");

const growthController = require("../../../controllers/tracking/growth/growthController");

const router = express.Router();

router.get(
  "/:childId/growth/latest",
  growthController.getLatestGrowthMeasurements,
);

router.get("/:childId/growth/:entryId", growthController.getGrowthEntry);

router.post("/:childId/growth", growthController.createGrowthEntry);

router.patch("/:childId/growth/:entryId", growthController.updateGrowthEntry);

module.exports = router;
