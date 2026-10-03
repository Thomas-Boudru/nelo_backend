const express = require("express");

const sleepController = require("../../../controllers/tracking/sleep/sleepController");

const router = express.Router();

router.get("/:childId/sleep/:entryId", sleepController.getSleepEntry);

router.post("/:childId/sleep", sleepController.createSleepEntry);

router.patch("/:childId/sleep/:entryId", sleepController.updateSleepEntry);

module.exports = router;
