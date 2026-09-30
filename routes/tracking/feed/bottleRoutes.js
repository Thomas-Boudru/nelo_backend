const express = require("express");

const {
  getBottleEntry,
  createBottleEntry,
  updateBottleEntry,
} = require("../../../controllers/tracking/bottle/bottleController");

const router = express.Router();

router.get("/:childId/bottles/:entryId", getBottleEntry);

router.post("/:childId/bottles", createBottleEntry);

// PUT : le front transmet tous les champs du repas.
router.put("/:childId/bottles/:entryId", updateBottleEntry);

module.exports = router;
