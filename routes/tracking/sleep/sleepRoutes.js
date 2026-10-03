const express = require("express");

const sleepController = require("../../../controllers/tracking/sleep/sleepController");

const router = express.Router();

// Cette route doit précéder /sleep/:entryId,
// sinon "active" serait interprété comme un identifiant.
router.get("/:childId/sleep/active", sleepController.getActiveSleepEntry);

router.post("/:childId/sleep/start", sleepController.startSleepEntry);

router.patch("/:childId/sleep/:entryId/stop", sleepController.stopSleepEntry);

router.get("/:childId/sleep/:entryId", sleepController.getSleepEntry);

router.post("/:childId/sleep", sleepController.createSleepEntry);

router.patch("/:childId/sleep/:entryId", sleepController.updateSleepEntry);

module.exports = router;
