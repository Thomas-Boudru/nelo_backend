const express = require("express");

const momentController = require("../../controllers/moments/momentController");

const router = express.Router();

router.get("/:childId/moments/sync", momentController.syncMoments);

router.get("/:childId/moments", momentController.listMoments);

router.get("/:childId/moments/:momentId", momentController.getMoment);

router.post("/:childId/moments", momentController.createMoment);

router.patch("/:childId/moments/:momentId", momentController.updateMoment);

router.delete("/:childId/moments/:momentId", momentController.deleteMoment);

router.post(
  "/:childId/moments/:momentId/publish",
  momentController.publishMoment,
);

module.exports = router;
