const express = require("express");

const {
  getCustomMedications,
  createCustomMedication,
  updateCustomMedication,
  archiveCustomMedication,
  getCustomVaccines,
  createCustomVaccine,
  updateCustomVaccine,
  archiveCustomVaccine,
} = require("../../../controllers/tracking/medication/customProductsController");

const router = express.Router();

router.get("/:childId/custom-medications", getCustomMedications);
router.post("/:childId/custom-medications", createCustomMedication);

router.patch("/:childId/custom-medications/:productId", updateCustomMedication);

router.delete(
  "/:childId/custom-medications/:productId",
  archiveCustomMedication,
);

router.get("/:childId/custom-vaccines", getCustomVaccines);
router.post("/:childId/custom-vaccines", createCustomVaccine);

router.patch("/:childId/custom-vaccines/:productId", updateCustomVaccine);

router.delete("/:childId/custom-vaccines/:productId", archiveCustomVaccine);

module.exports = router;
