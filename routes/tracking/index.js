const express = require("express");

const authenticate = require("../../middleware/authenticate");

const bottlePresetRoutes = require("./feed/bottlePresetRoutes");
const bottleRoutes = require("./feed/bottleRoutes");

const router = express.Router();

router.use(authenticate);
router.use(bottlePresetRoutes);
router.use(bottleRoutes);

module.exports = router;
