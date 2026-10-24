const express = require("express");

const authenticate = require("../../middleware/authenticate");

const {
  getChildSleepPrediction,
} = require("../../controllers/sleepPrediction/sleepPredictionController");

const router = express.Router({
  mergeParams: true,
});

router.get("/", authenticate, getChildSleepPrediction);

module.exports = router;
