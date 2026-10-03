const express = require("express");

const authenticate = require("../../middleware/authenticate");

const trackingRoutes = require("./trackingRoutes");
const bottleRoutes = require("./feed/bottleRoutes");
const bottlePresetRoutes = require("./feed/bottlePresetRoutes");
const bottlePresetUpdateRoutes = require("./feed/bottlePresetUpdateRoutes");
const breastfeedingRoutes = require("./feed/breastFeedingRoutes");
const pumpingRoutes = require("./feed/pumpingRoutes");
const customFoodRoutes = require("./feed/customFoodRoutes");
const solidFeedingRoutes = require("./feed/solidFeedingRoutes");
const trackingPhotoRoutes = require("./trackingPhotoRoutes");
const sleepRoutes = require("./sleep/sleepRoutes");
const toiletingRoutes = require("./diaper/toiletingRoutes");
const moodRoutes = require("./mood/moodRoutes");

const router = express.Router();

router.use(authenticate);

router.use(trackingRoutes);
router.use(bottleRoutes);
router.use(bottlePresetRoutes);
router.use(bottlePresetUpdateRoutes);
router.use(breastfeedingRoutes);
router.use(pumpingRoutes);
router.use(customFoodRoutes);
router.use(solidFeedingRoutes);
router.use(trackingPhotoRoutes);
router.use(sleepRoutes);
router.use(toiletingRoutes);
router.use(moodRoutes);

module.exports = router;
