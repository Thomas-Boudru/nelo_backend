const express = require("express");

const authenticate = require("../../middleware/authenticate");

const {
  completeOnboarding,
} = require("../../controllers/onboarding/onboardingController");

const router = express.Router();

router.post("/", authenticate, completeOnboarding);

module.exports = router;
