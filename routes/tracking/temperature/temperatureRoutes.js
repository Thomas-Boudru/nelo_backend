const express = require("express");

const temperatureController = require("../../../controllers/tracking/temperature/temperatureController");

const router = express.Router();

router.get(
  "/:childId/temperature/:entryId",
  temperatureController.getTemperatureEntry,
);

router.post(
  "/:childId/temperature",
  temperatureController.createTemperatureEntry,
);

router.patch(
  "/:childId/temperature/:entryId",
  temperatureController.updateTemperatureEntry,
);

module.exports = router;
