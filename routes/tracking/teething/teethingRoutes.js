const express = require("express");

const teethingController = require("../../../controllers/tracking/teething/teethingController");

const router = express.Router();

router.get("/:childId/teething/:entryId", teethingController.getTeethingEntry);

router.post("/:childId/teething", teethingController.createTeethingEntry);

router.patch(
  "/:childId/teething/:entryId",
  teethingController.updateTeethingEntry,
);

module.exports = router;
