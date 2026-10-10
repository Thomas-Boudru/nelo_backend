const express = require("express");
const rateLimit = require("express-rate-limit");

const authenticate = require("../../middleware/authenticate");

const {
  getSubscriptionProducts,
} = require("../../controllers/billing/subscriptionPurchaseController");

const {
  verifyApplePurchase,
} = require("../../controllers/billing/apple/applePurchaseController");

const router = express.Router();

const purchaseVerificationLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,

  keyGenerator: (req) => req.auth.userId,

  message: {
    error: {
      code: "TOO_MANY_PURCHASE_VERIFICATIONS",
      message:
        "Too many purchase verification attempts. Please try again shortly.",
    },
  },
});

router.get("/products", authenticate, getSubscriptionProducts);

router.post(
  "/apple/verify",
  authenticate,
  purchaseVerificationLimiter,
  verifyApplePurchase,
);

module.exports = router;
