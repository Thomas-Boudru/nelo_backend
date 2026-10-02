const express = require("express");

const authenticate = require("../../middleware/authenticate");

const trackingRoutes = require("./trackingRoutes");
const bottleRoutes = require("./feed/bottleRoutes");
const bottlePresetRoutes = require("./feed/bottlePresetRoutes");
const bottlePresetUpdateRoutes = require("./feed/bottlePresetUpdateRoutes");
const breastfeedingRoutes = require("./feed/breastFeedingRoutes");

const router = express.Router();

router.use(authenticate);

router.use(trackingRoutes);
router.use(bottleRoutes);
router.use(bottlePresetRoutes);
router.use(bottlePresetUpdateRoutes);
router.use(breastfeedingRoutes);

module.exports = router;
