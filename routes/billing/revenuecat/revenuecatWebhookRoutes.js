const express = require("express");

const {
  receiveRevenueCatWebhook,
} = require("../../../controllers/billing/revenuecat/revenuecatWebhookController");

const router = express.Router();

router.post("/", receiveRevenueCatWebhook);

module.exports = router;
