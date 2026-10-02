const express = require("express");

const {
  listCustomFoods,
  createCustomFood,
  updateCustomFood,
  deleteCustomFood,
} = require("../../../controllers/tracking/feed/customFoodController");

const router = express.Router();

router.get("/:childId/custom-foods", listCustomFoods);

router.post("/:childId/custom-foods", createCustomFood);

router.put("/:childId/custom-foods/:foodId", updateCustomFood);

router.delete("/:childId/custom-foods/:foodId", deleteCustomFood);

module.exports = router;
