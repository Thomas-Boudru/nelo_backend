const express = require("express");

const authenticate = require("../../middleware/authenticate");

const {
  getFamilyEntitlements,
} = require("../../controllers/billing/familyEntitlementsController");

const {
  createSubscriptionPurchaseIntent,
} = require("../../controllers/billing/subscriptionPurchaseController");

const router = express.Router();

router.get("/:familyId/entitlements", authenticate, getFamilyEntitlements);

router.post(
  "/:familyId/billing/purchase-intents",
  authenticate,
  createSubscriptionPurchaseIntent,
);

module.exports = router;
