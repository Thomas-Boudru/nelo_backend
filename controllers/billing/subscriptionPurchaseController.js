const {
  getSubscriptionProducts: getProducts,
  createSubscriptionPurchaseIntent: createIntent,
} = require("../../services/billing/subscriptionPurchaseService");

async function getSubscriptionProducts(req, res, next) {
  try {
    const products = await getProducts({
      store: req.query.store,
    });

    res.set("Cache-Control", "no-store");

    return res.status(200).json({ products });
  } catch (error) {
    return next(error);
  }
}

async function createSubscriptionPurchaseIntent(req, res, next) {
  try {
    const purchaseIntent = await createIntent({
      familyId: req.params.familyId,
      userId: req.auth.userId,
      productId: req.body?.productId,
      idempotencyKey: req.get("Idempotency-Key"),
    });

    res.set("Cache-Control", "no-store");

    return res
      .status(purchaseIntent.replayed ? 200 : 201)
      .json({ purchaseIntent });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getSubscriptionProducts,
  createSubscriptionPurchaseIntent,
};
