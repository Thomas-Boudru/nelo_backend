const {
  verifyAndSaveApplePurchase,
} = require("../../../services/billing/apple/applePurchaseService");

async function verifyApplePurchase(req, res, next) {
  try {
    const result = await verifyAndSaveApplePurchase({
      userId: req.auth.userId,
      purchaseIntentId: req.body?.purchaseIntentId,
      transactionId: req.body?.transactionId,
    });

    res.set("Cache-Control", "no-store");

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  verifyApplePurchase,
};
