const express = require("express");

const customMilestoneController = require("../../controllers/moments/customMilestoneController");

const router = express.Router();

router.get(
  "/:childId/custom-milestones",
  customMilestoneController.listCustomMilestones,
);

router.post(
  "/:childId/custom-milestones",
  customMilestoneController.createCustomMilestone,
);

router.patch(
  "/:childId/custom-milestones/:milestoneId",
  customMilestoneController.updateCustomMilestone,
);

router.delete(
  "/:childId/custom-milestones/:milestoneId",
  customMilestoneController.archiveCustomMilestone,
);

module.exports = router;
