const express = require("express");

const authenticate = require("../../middleware/authenticate");

const momentRoutes = require("./momentRoutes");
const momentPhotoRoutes = require("./momentPhotoRoutes");
const customMilestoneRoutes = require("./customMilestoneRoutes");

const router = express.Router();

router.use(authenticate);

router.use(momentRoutes);
router.use(momentPhotoRoutes);
router.use(customMilestoneRoutes);

module.exports = router;
